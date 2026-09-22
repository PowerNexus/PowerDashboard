import {
  type Database,
  nodeResellerShares,
  resellerQuotas,
  serverMetrics,
  servers,
  users,
} from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";
import { NotificationsService } from "../notifications/notifications.service";
import { ResellerQuotaService } from "../reseller/reseller-quota.service";
import { ResellerShareService } from "../reseller/reseller-share.service";
import { WebhookEmitterService } from "../webhooks/webhook-emitter.service";
import { WingsClientService } from "../wings/wings-client.service";

/**
 * Coupure d'un serveur dont le revendeur dépasse sa part de mémoire.
 *
 * C'est la contrepartie du surprovisionnement. Un revendeur vend plus qu'il ne
 * détient — c'est le modèle — et le plafond ne porte donc pas sur les limites
 * accordées mais sur la **consommation réelle**. Quand celle-ci dépasse la part,
 * la machine est en danger pour tous ceux qui s'y trouvent : il faut rendre de
 * la mémoire, et l'arbitrage revient à celui qui dépasse.
 *
 * Trois règles gouvernent ce service, et chacune existe pour éviter une façon
 * précise de nuire :
 *
 * 1. **Jamais sur une estimation.** Quand une consommation n'a pas été relevée,
 *    `usageOnNode` retombe sur les limites accordées, qui **majorent** le réel.
 *    Couper là-dessus arrêterait des serveurs qui ne consomment rien. Un
 *    dépassement dont la base n'est pas `measured` est donc ignoré, et dit.
 * 2. **Jamais sur une seule lecture.** Une génération de monde ou un
 *    chargement de plugins fait un pic d'une minute. Il faut plusieurs tours
 *    consécutifs au-dessus du plafond pour qu'on agisse.
 * 3. **Un serveur à la fois, le plus gourmand.** Arrêter tout le parc d'un
 *    revendeur pour un dépassement de deux gigaoctets serait disproportionné.
 *    On rend la mémoire du plus gros consommateur et on regarde au tour
 *    suivant si cela a suffi.
 *
 * **Deux plafonds sont surveillés, et ils ne disent pas la même chose :**
 *
 * - la **part** qu'il détient sur une machine partagée — ce qu'il peut prendre
 *   *ici*, aux côtés d'autres revendeurs. Le dépasser met la machine en danger
 *   pour des tiers ;
 * - son **enveloppe** globale — ce qu'il peut vendre *partout*, son propre
 *   matériel compris. C'est un engagement commercial, pas une question de
 *   capacité.
 *
 * Seules les parts étaient surveillées, et cela laissait un trou entier : un
 * revendeur sur une machine **dédiée** n'a aucune part, donc n'était jamais
 * regardé. Son enveloppe ne lui était opposée qu'à la création — il pouvait la
 * dépasser indéfiniment tant qu'il ne commandait rien de nouveau, et l'écran de
 * quota affichait un dépassement sans la moindre conséquence.
 */

/**
 * Ce qui est surveillé : un plafond, un périmètre, et de quoi le nommer.
 *
 * Une seule forme pour les deux sortes de plafond, parce que la décision est
 * rigoureusement la même — mesurer, patienter, couper le plus gourmand. Seuls
 * changent ce qu'on mesure et ce qu'on écrit au client.
 */
interface Perimetre {
  /** Clé de suivi des dépassements consécutifs. */
  cle: string;
  genre: "part" | "enveloppe";
  resellerId: string;
  /** La machine visée, ou `null` quand le plafond porte sur tout son parc. */
  nodeId: string | null;
  plafondMb: number;
}

/** Un tour par minute : la cadence à laquelle le collecteur écrit ses relevés. */
const TICK_MS = 60_000;

/**
 * Tours consécutifs au-dessus du plafond avant d'agir.
 *
 * Trois minutes de dépassement continu. Assez pour laisser passer un pic de
 * démarrage, assez court pour qu'une fuite de mémoire ne mette pas la machine
 * à genoux avant qu'on réagisse.
 */
const BREACHES_BEFORE_ACTION = 3;

@Injectable()
export class QuotaEnforcerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuotaEnforcerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /**
   * Dépassements consécutifs par part, en mémoire du processus.
   *
   * Volontairement pas en base. Un redémarrage du panel remet les compteurs à
   * zéro, donc **laisse une seconde chance** : c'est le bon sens du doute pour
   * une action irréversible du point de vue des joueurs connectés. Persister
   * l'inverse — couper juste après un redémarrage, sur un compte accumulé la
   * veille — serait la mauvaise surprise.
   */
  private readonly breaches = new Map<string, number>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
    @Inject(ResellerShareService) private readonly shares: ResellerShareService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(WebhookEmitterService) private readonly webhooks: WebhookEmitterService,
    @Inject(ResellerQuotaService) private readonly quotas: ResellerQuotaService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "quota-enforcer", () => this.tick()),
      TICK_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Un tour : chaque plafond, son dépassement éventuel, sa conséquence. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      /*
       * Un revendeur ne perd **qu'un** serveur par tour, quel que soit le
       * nombre de plafonds qu'il dépasse.
       *
       * Sans cette retenue, celui qui déborde à la fois de sa part et de son
       * enveloppe en perdrait deux dans la même minute — et la troisième règle
       * de ce service, « un serveur à la fois », cesserait d'être vraie au
       * moment précis où elle protège le plus.
       */
      const dejaCoupes = new Set<string>();

      for (const perimetre of await this.perimetres()) {
        if (dejaCoupes.has(perimetre.resellerId)) continue;
        if (await this.check(perimetre)) dejaCoupes.add(perimetre.resellerId);
      }
    } catch (error) {
      this.logger.warn(`Tour de contrôle interrompu : ${describe(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Tout ce qu'il y a à surveiller, les parts puis les enveloppes.
   *
   * Les parts d'abord, à dessein : leur dépassement met en danger des tiers sur
   * la même machine, celui d'une enveloppe n'engage que le revendeur. Quand les
   * deux débordent et qu'un seul serveur sera coupé, c'est le danger partagé
   * qui doit l'emporter.
   */
  private async perimetres(): Promise<Perimetre[]> {
    const parts = await this.db
      .select({
        nodeId: nodeResellerShares.nodeId,
        resellerId: nodeResellerShares.resellerId,
        memoryMb: nodeResellerShares.memoryMb,
      })
      .from(nodeResellerShares);

    /*
     * Seules les enveloppes qui **posent** un plafond de mémoire.
     *
     * `null` veut dire « sans limite » et jamais zéro : confondre les deux
     * couperait tout le parc de chaque revendeur à qui l'on n'a rien fixé.
     */
    const enveloppes = await this.db
      .select({
        resellerId: resellerQuotas.userId,
        memoryMb: resellerQuotas.memoryMb,
      })
      .from(resellerQuotas)
      .where(isNotNull(resellerQuotas.memoryMb));

    return [
      ...parts.map(
        (part): Perimetre => ({
          cle: `part:${part.nodeId}:${part.resellerId}`,
          genre: "part",
          resellerId: part.resellerId,
          nodeId: part.nodeId,
          plafondMb: part.memoryMb,
        }),
      ),
      ...enveloppes.map(
        (enveloppe): Perimetre => ({
          cle: `enveloppe:${enveloppe.resellerId}`,
          genre: "enveloppe",
          resellerId: enveloppe.resellerId,
          nodeId: null,
          plafondMb: enveloppe.memoryMb ?? 0,
        }),
      ),
    ];
  }

  /** Rend `true` si un serveur a été arrêté pour ce périmètre. */
  private async check(part: Perimetre): Promise<boolean> {
    const key = part.cle;
    const usage =
      part.nodeId === null
        ? await this.quotas.usageDetailedOf(part.resellerId)
        : await this.shares.usageOnNode(part.nodeId, part.resellerId);

    /*
     * Une consommation non relevée n'est pas un dépassement.
     *
     * `usageOnNode` majore par les limites quand la mesure manque : le chiffre
     * rendu est alors **au-dessus** du réel par construction. Agir dessus
     * arrêterait des serveurs qui ne consomment rien. On remet même le
     * compteur à zéro : un dépassement qu'on ne sait plus mesurer n'est pas un
     * dépassement qui continue.
     */
    if (usage.basis !== "measured") {
      if (this.breaches.delete(key)) {
        this.logger.log(
          `${key} : suivi interrompu, ${usage.unmeasured} serveur(s) sans relevé récent.`,
        );
      }
      return false;
    }

    if (usage.memoryMb <= part.plafondMb) {
      this.breaches.delete(key);
      return false;
    }

    const count = (this.breaches.get(key) ?? 0) + 1;
    this.breaches.set(key, count);

    if (count < BREACHES_BEFORE_ACTION) {
      this.logger.log(
        `${key} : ${usage.memoryMb} Mo sur ${part.plafondMb} — ${count}/${BREACHES_BEFORE_ACTION} avant coupure.`,
      );
      return false;
    }

    const coupe = await this.stopHeaviest(part, usage.memoryMb);
    // Le compteur repart : on regarde au tour suivant si la coupure a suffi,
    // plutôt que d'enchaîner les arrêts sur la même décision.
    this.breaches.delete(key);
    return coupe;
  }

  /**
   * Arrête le serveur qui consomme le plus, et lui seul.
   *
   * Le plus gourmand parce que c'est celui qui rend le plus de mémoire pour un
   * seul arrêt : couper trois petits serveurs dérangerait trois fois plus de
   * monde pour le même résultat.
   *
   * Les serveurs sans relevé sont écartés du choix : on n'arrête pas un serveur
   * sur une consommation supposée, même quand la part, elle, est mesurée.
   */
  private async stopHeaviest(part: Perimetre, usedMb: number): Promise<boolean> {
    const [heaviest] = await this.db
      .select({
        id: servers.id,
        name: servers.name,
        nodeId: servers.nodeId,
        memBytes: sql<number>`(
          select m.mem_bytes from ${serverMetrics} m
          where m.server_id = ${servers.id} and m.at > now() - interval '5 minutes'
          order by m.at desc limit 1
        )`,
      })
      .from(servers)
      .where(
        and(
          /*
           * Le périmètre du choix est **celui de la mesure**.
           *
           * Sur une part, les serveurs de ce revendeur sur cette machine. Sur
           * une enveloppe, tout son parc — provisionné sous lui ou possédé en
           * propre, exactement l'union que compte `usageDetailedOf`. Mesurer
           * sur un ensemble et couper dans un autre constaterait un dépassement
           * sans jamais trouver quoi arrêter.
           */
          part.nodeId === null
            ? or(eq(servers.resellerId, part.resellerId), eq(servers.ownerId, part.resellerId))
            : and(eq(servers.nodeId, part.nodeId), eq(servers.resellerId, part.resellerId)),
          // Un serveur déjà suspendu ou en installation ne consomme pas ce
          // qu'on cherche à libérer, et l'arrêter n'y changerait rien.
          sql`${servers.state} is null`,
        ),
      )
      .orderBy(sql`4 desc nulls last`)
      .limit(1);

    if (!heaviest || heaviest.memBytes === null) {
      this.logger.warn(`${part.cle} en dépassement, mais aucun serveur mesuré à arrêter.`);
      return false;
    }

    const freedMb = Math.round(heaviest.memBytes / (1024 * 1024));
    await this.wings.power(heaviest.id, "stop").catch((error) => {
      this.logger.error(`Coupure de ${heaviest.id} refusée par le node : ${describe(error)}`);
    });

    this.logger.warn(
      `Serveur ${heaviest.name} (${heaviest.id}) arrêté : ${part.genre} à ${usedMb} Mo ` +
        `sur ${part.plafondMb}, ${freedMb} Mo rendus.`,
    );

    /*
     * Le propriétaire **et** le revendeur sont prévenus, et pas du même fait.
     *
     * Le client subit un arrêt qu'il n'a pas demandé et doit savoir pourquoi.
     * Le revendeur, lui, doit savoir que sa part est pleine — c'est à lui de
     * décider s'il relève son enveloppe ou s'il réduit sa vente.
     */
    await this.notifications.notifyServerOwner(heaviest.id, {
      type: "server.quota_stopped",
      level: "danger",
      title: "Serveur arrêté : mémoire dépassée",
      /*
       * Le client n'a pas à connaître nos mécanismes, mais il a droit à un
       * motif exact. « Sur cette machine » serait faux pour une enveloppe, qui
       * porte sur tout le parc de son hébergeur — et une explication fausse est
       * pire qu'une explication vague, parce qu'il la répétera au support.
       */
      body:
        part.genre === "part"
          ? `La part de mémoire de votre hébergeur est dépassée sur cette machine. Ce serveur a été arrêté pour rendre ${freedMb} Mo. Contactez-le pour la relever.`
          : `L'enveloppe de mémoire de votre hébergeur est dépassée. Ce serveur a été arrêté pour rendre ${freedMb} Mo. Contactez-le pour la relever.`,
    });

    const [reseller] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, part.resellerId))
      .limit(1);

    if (reseller) {
      await this.notifications.notify({
        userId: reseller.id,
        type: "reseller.quota_enforced",
        level: "danger",
        title: part.genre === "part" ? "Part de mémoire dépassée" : "Enveloppe de mémoire dépassée",
        body:
          part.genre === "part"
            ? `Votre part consommait ${usedMb} Mo sur ${part.plafondMb} sur cette machine. Le serveur « ${heaviest.name} » a été arrêté pour revenir sous le plafond.`
            : `Votre enveloppe consommait ${usedMb} Mo sur ${part.plafondMb}, tous parcs confondus. Le serveur « ${heaviest.name} » a été arrêté pour revenir sous le plafond.`,
      });
    }

    // La boutique en est informée aussi : un arrêt subi est un motif de
    // contact client, et elle est seule à savoir quoi en faire.
    await this.webhooks.emit("server.quota_stopped", {
      serverId: heaviest.id,
      resellerId: part.resellerId,
      // Celui du serveur arrêté, toujours connu — le plafond, lui, ne vise pas
      // forcément une machine.
      nodeId: heaviest.nodeId,
      /*
       * Lequel des deux plafonds a parlé.
       *
       * Sans ce champ, `quotaMb` serait tantôt une part, tantôt une enveloppe,
       * et la boutique ne saurait pas quoi proposer : acheter de la capacité
       * sur cette machine, ou relever son forfait. Deux réponses commerciales
       * opposées derrière un même nombre.
       */
      basis: part.genre === "part" ? "share" : "envelope",
      usedMb,
      quotaMb: part.plafondMb,
      freedMb,
    });

    return true;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
