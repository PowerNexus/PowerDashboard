import { decryptSecret } from "@gamedashboard/auth";
import { NODE_HEARTBEAT_INTERVAL_MS } from "@gamedashboard/contracts";
import { type Database, nodes } from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";

/**
 * Le panel demande au daemon s'il est là, au lieu d'attendre qu'il parle.
 *
 * Relevé sur un vrai Wings : un daemon **sans serveur** ne contacte le panel
 * qu'à son démarrage. Il pousse ensuite ses relevés d'activité et de SFTP à la
 * minute, mais uniquement quand il a quelque chose à dire — et un node vide n'a
 * jamais rien à dire. Le panel, qui ne déduisait la santé que du dernier appel
 * reçu, le déclarait « en retard » après deux minutes puis « injoignable »,
 * alors qu'il tournait parfaitement.
 *
 * Conclure à une panne sur son propre silence est le défaut que cette sonde
 * corrige : la seule façon honnête de savoir si une machine répond est de lui
 * demander.
 *
 * Elle ne remplace pas le heartbeat entrant, elle le complète. Un node chargé
 * parle de lui-même à longueur de journée, et la sonde ne le dérange pas — elle
 * ne s'adresse qu'à ceux qu'on n'a pas entendus depuis un moment.
 */

/**
 * Cadence de la sonde, et silence qui la déclenche.
 *
 * Les deux **dérivent** du contrat plutôt que d'être choisies ici, et c'est le
 * fond du problème qu'elles corrigent. `NODE_HEARTBEAT_INTERVAL_MS` dit depuis
 * le début à quel rythme on attend des nouvelles d'un node, et
 * `NODE_HEARTBEAT_STALE_MS` à partir de quand l'écran conclut au retard — mais
 * rien ne produisait ce rythme, puisque Wings ne bat pas la mesure. Une sonde
 * posée à la minute laissait l'âge du dernier contact dépasser le seuil entre
 * deux tours : le node clignotait « en retard » en permanence, alors que le
 * panel venait de lui parler.
 *
 * Au pire, l'âge atteint la somme des deux — un tour complet de silence toléré,
 * plus un tour d'attente — et c'est cette somme qui doit rester sous le seuil.
 * La lier au contrat interdit qu'un ajustement de l'un sans l'autre les remette
 * en contradiction, et le test s'en assure.
 */
export const PROBE_TICK_MS = NODE_HEARTBEAT_INTERVAL_MS;
export const PROBE_SILENCE_MS = NODE_HEARTBEAT_INTERVAL_MS;

/**
 * Court : une sonde qui traîne retarde le tour entier.
 *
 * Un node qui met plus de cinq secondes à dire bonjour est de toute façon un
 * node dont on veut parler.
 */
const TIMEOUT_MS = 5_000;

/** Nombre de sondes menées de front. Un parc se mesure en dizaines, pas en milliers. */
const CONCURRENCY = 8;

@Injectable()
export class NodeProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeProbeService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "node-probe", () => this.tick()),
      PROBE_TICK_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Un tour : demander à ceux qu'on n'a pas entendus.
   *
   * Le verrou `running` évite qu'un tour lent en chevauche un autre : deux
   * tours simultanés sonderaient les mêmes nodes et écriraient deux fois.
   */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const silent = await this.db
        .select({
          id: nodes.id,
          name: nodes.name,
          scheme: nodes.scheme,
          fqdn: nodes.fqdn,
          port: nodes.daemonPort,
          tokenEnc: nodes.daemonTokenEnc,
        })
        .from(nodes)
        .where(
          and(
            // Un node en maintenance est silencieux **parce qu'on l'a voulu** :
            // le sonder produirait un échec qui n'apprend rien.
            eq(nodes.maintenanceMode, false),
            or(
              isNull(nodes.lastHeartbeatAt),
              lt(
                nodes.lastHeartbeatAt,
                sql`now() - ${`${PROBE_SILENCE_MS} milliseconds`}::interval`,
              ),
            ),
          ),
        );

      for (let i = 0; i < silent.length; i += CONCURRENCY) {
        await Promise.all(silent.slice(i, i + CONCURRENCY).map((node) => this.probe(node)));
      }
    } catch (error) {
      // Un tour raté ne doit pas arrêter le minuteur : le suivant retentera.
      this.logger.warn(`Tour de sonde interrompu : ${describe(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Une sonde.
   *
   * L'échec n'écrit **rien**. C'est délibéré : l'absence de contact est déjà
   * l'information, et poser une marque « injoignable » à côté de l'horodatage
   * créerait deux vérités qui finiraient par se contredire. Le node reste vu
   * pour la dernière fois quand il a été vu pour la dernière fois.
   */
  private async probe(node: {
    id: string;
    name: string;
    scheme: string;
    fqdn: string;
    port: number;
    tokenEnc: string;
  }): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${node.scheme}://${node.fqdn}:${node.port}/api/system`, {
        headers: {
          Authorization: `Bearer ${decryptSecret(node.tokenEnc)}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      // 401 et 403 disent que la machine répond, mais avec un autre jeton que
      // le nôtre. Elle est donc joignable, et pourtant inutilisable : la
      // compter vivante masquerait une configuration à refaire.
      if (!response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { version?: unknown };
      /*
       * Deux sources, un seul format.
       *
       * Le daemon rend « v1.13.3 » ici et « vv1.13.3 » dans son agent
       * utilisateur ; la lecture de l'agent, elle, range « 1.13.3 ». Écrire
       * les deux formes en base ferait que la comparaison à la version la plus
       * récente conclurait « à jour » ou « en retard » selon la façon dont le
       * node s'est manifesté en dernier, ce qui n'a aucun sens.
       */
      const version =
        typeof body.version === "string" ? body.version.replace(/^v+/, "").trim() || null : null;

      await this.db
        .update(nodes)
        .set({
          lastHeartbeatAt: new Date().toISOString(),
          // La version rendue ici est celle du daemon lui-même, sans le `v`
          // qu'il colle dans son agent utilisateur. Une version absente
          // n'écrase pas celle qu'on connaissait.
          ...(version ? { wingsVersion: version } : {}),
        })
        .where(eq(nodes.id, node.id));
    } catch {
      // Silence volontaire : un node éteint n'est pas une anomalie du panel, et
      // une ligne de journal par node et par minute noierait les vraies.
    } finally {
      clearTimeout(timer);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
