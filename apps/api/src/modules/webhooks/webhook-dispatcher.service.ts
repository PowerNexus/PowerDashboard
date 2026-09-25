import { createHmac } from "node:crypto";
import {
  discordWebhookBody,
  isDiscordWebhookUrl,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNATURE_HEADER,
  webhookRetryDelayMs,
  webhookShouldRetry,
  webhookSignatureHeader,
  webhookSignaturePayload,
} from "@gamedashboard/contracts";
import type { Database } from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";
import { decryptRowSecret } from "../../common/row-secrets";
import {
  applicationQueue,
  clientQueue,
  type DueDelivery,
  type WebhookQueue,
} from "./webhook-queue";

/**
 * Cadence du balayage.
 *
 * Dix secondes : un rappel dit « votre serveur est prêt », et une minute
 * d'attente se voit à l'écran du client. Le coût est une requête indexée sur
 * une colonne d'échéance, qui ne rend rien la plupart du temps.
 */
const TICK_MS = 10_000;

/** Livraisons traitées par tour **et par file**, pour qu'un arriéré ne monopolise pas le processus. */
const BATCH = 20;

/** Au-delà, la réponse ne sert plus à diagnostiquer : elle encombre. */
const RESPONSE_EXCERPT = 2000;

/** Un receveur lent ne doit pas retenir le répartiteur. */
const TIMEOUT_MS = 10_000;

/**
 * Envoi des rappels sortants, **pour les deux files**.
 *
 * Il lit une file en base plutôt qu'une file en mémoire, et c'est ce qui rend
 * le mécanisme utilisable : un rappel perdu parce que l'API a redémarré entre
 * l'événement et l'envoi serait un rappel que personne ne réclame — le
 * destinataire ignore qu'il devait le recevoir. Ce qui est écrit repart tout
 * seul.
 *
 * Les deux files — celle de la plateforme vers un tiers, celle d'un serveur
 * vers son propriétaire — partagent ce répartiteur et ne se distinguent que
 * par leur persistance. Écrire deux fois la signature, les délais de reprise et
 * la règle d'abandon aurait garanti qu'ils divergent : un jour l'un réessaie
 * six fois et l'autre cinq, et plus personne ne sait lequel a raison.
 *
 * Même forme que `ScheduleRunnerService`, et pour les mêmes raisons : un
 * minuteur `unref`, un tour non réentrant, et une prise d'échéances écrite pour
 * supporter plusieurs lecteurs le jour où il y aura plusieurs instances.
 */
@Injectable()
export class WebhookDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly queues: WebhookQueue[];

  constructor(@Inject(DATABASE) db: Database) {
    this.queues = [applicationQueue(db), clientQueue(db)];
  }

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "webhook-dispatcher", () => this.tick()),
      TICK_MS,
    );
    // Ce minuteur ne doit pas empêcher le processus de s'arrêter.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const queue of this.queues) {
        for (const due of await queue.claimDue(now, BATCH)) {
          await this.deliver(queue, due).catch((error) => {
            this.logger.error(`Livraison ${due.id} (${queue.label}) : ${message(error)}`);
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Un envoi, et ce qu'on en fait. */
  private async deliver(queue: WebhookQueue, due: DueDelivery): Promise<void> {
    // Un salon Discord n'accepte que son propre format : le corps générique y
    // était refusé à chaque envoi (`discord-webhook.ts`).
    const body = JSON.stringify(
      isDiscordWebhookUrl(due.url) ? discordWebhookBody(due.event, due.payload) : due.payload,
    );
    const timestamp = Math.floor(Date.now() / 1000);

    /**
     * La signature couvre l'horodatage **et** le corps.
     *
     * Signer le corps seul rendrait la livraison rejouable indéfiniment : un
     * intermédiaire qui la capte pourrait la renvoyer un an plus tard et faire
     * rouvrir un service résilié.
     */
    const secret = decryptRowSecret(queue.secretColumn, due.webhookId, due.secretEnc);
    const signature = createHmac("sha256", secret)
      .update(webhookSignaturePayload(timestamp, body))
      .digest("hex");

    let status: number | null = null;
    let excerpt: string | null = null;

    try {
      const response = await fetch(due.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [WEBHOOK_SIGNATURE_HEADER]: webhookSignatureHeader(timestamp, signature),
          [WEBHOOK_EVENT_HEADER]: due.event,
          // L'identifiant de livraison ne change pas d'une tentative à l'autre :
          // c'est ce qui permet au receveur de dédoublonner sans deviner.
          [WEBHOOK_DELIVERY_HEADER]: due.id,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Une redirection n'est pas suivie : l'adresse vérifiée à
        // l'enregistrement est la seule qui reçoit le rappel, pas celle vers
        // laquelle elle déciderait de renvoyer ensuite.
        redirect: "manual",
      });

      status = response.status;
      excerpt = (await response.text().catch(() => "")).slice(0, RESPONSE_EXCERPT);
    } catch (error) {
      // Aucune réponse : panne réseau, DNS, délai dépassé. On garde la cause,
      // qui est souvent la seule chose exploitable à la relecture.
      excerpt = message(error).slice(0, RESPONSE_EXCERPT);
    }

    const ok = status !== null && status >= 200 && status < 300;
    const attempts = due.attempts + 1;
    const settled = { attempts, status, excerpt };

    if (ok) {
      await queue.settle(due.id, settled, "delivered");
      await queue.touch(due.webhookId, true);
      return;
    }

    const retryIn = webhookShouldRetry(status) ? webhookRetryDelayMs(attempts) : null;

    if (retryIn === null || attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await queue.settle(due.id, settled, "abandoned");
      await queue.touch(due.webhookId, false);
      this.logger.warn(
        `Rappel « ${due.event} » abandonné après ${attempts} tentative(s) vers ${due.url} (${status ?? "aucune réponse"}).`,
      );
      return;
    }

    await queue.retry(due.id, settled, new Date(Date.now() + retryIn));
    await queue.touch(due.webhookId, false);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
