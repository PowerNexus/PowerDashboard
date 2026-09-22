import {
  checkQuota,
  checkQuotaGrowth,
  QUOTA_DIMENSION_LABELS,
  type QuotaUsage,
  type ResellerQuota,
  UNLIMITED_QUOTA,
} from "@gamedashboard/contracts";
import { type Database, resellerQuotas, serverMetrics, servers, users } from "@gamedashboard/db";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Âge au-delà duquel un relevé ne compte plus.
 *
 * Une mesure d'il y a une heure ne dit rien de la consommation présente. La
 * traiter comme actuelle ferait décider sur une photo périmée — dans un sens
 * comme dans l'autre.
 */
const MEASUREMENT_MAX_AGE_SECONDS = 300;

/** Dernier relevé de mémoire d'un serveur, en Mo. `null` si aucun n'est frais. */
const LATEST_MEM_MB = sql`(
  select round(m.mem_bytes / 1048576.0) from ${serverMetrics} m
  where m.server_id = ${servers.id}
    and m.at > now() - interval '${sql.raw(String(MEASUREMENT_MAX_AGE_SECONDS))} seconds'
  order by m.at desc limit 1
)`;

const LATEST_DISK_MB = sql`(
  select round(m.disk_bytes / 1048576.0) from ${serverMetrics} m
  where m.server_id = ${servers.id}
    and m.at > now() - interval '${sql.raw(String(MEASUREMENT_MAX_AGE_SECONDS))} seconds'
  order by m.at desc limit 1
)`;

/**
 * Un quota accompagné de ce qu'il reste, pour les écrans.
 *
 * La consommation est rendue **avec la qualité de sa mesure**, et pas seulement
 * avec ses chiffres : depuis que le surveillant coupe sur l'enveloppe, un
 * dépassement mesuré et un dépassement estimé n'annoncent pas du tout la même
 * suite. Un écran qui ne verrait que les nombres promettrait une coupure dans
 * un cas où rien n'arrivera.
 */
export interface ResellerQuotaReport {
  quota: ResellerQuota;
  usage: QuotaUsageDetailed;
}

/**
 * La même consommation, plus la **qualité** de la mesure.
 *
 * Refuser une création et couper un serveur ne demandent pas la même
 * certitude. Refuser sur une estimation majorée est prudent : au pire on
 * refuse une commande qui serait passée. Couper sur la même estimation
 * arrêterait un serveur qui ne consomme rien — un client dérangé pour une
 * supposition. D'où ce supplément, que seul le second usage regarde.
 */
export interface QuotaUsageDetailed extends QuotaUsage {
  basis: "measured" | "estimated" | "partial";
  /** Serveurs dont la consommation n'a pas pu être relevée. */
  unmeasured: number;
}

/**
 * L'enveloppe de ressources d'un revendeur.
 *
 * Le plafond est **global** et non par machine : il compte tout ce que le
 * revendeur fait tourner, son propre matériel compris. Il vient en plus des
 * parts posées machine par machine (`node_reseller_shares`) — la part borne ce
 * qu'il peut prendre ici, l'enveloppe borne son total partout.
 *
 * Il porte sur la **consommation réellement relevée**, pas sur la somme des
 * limites accordées aux serveurs. C'est ce qui rend la revente possible : on
 * vend plus qu'on ne détient tant que les clients n'utilisent pas tout.
 * Compter les limites interdirait le surprovisionnement, c'est-à-dire le
 * métier lui-même.
 *
 * L'arbitrage lui-même est dans `@gamedashboard/contracts` (`checkQuota`) : ce
 * service ne fait que lire la base et traduire un refus en message.
 */
@Injectable()
export class ResellerQuotaService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Enveloppe accordée à un compte.
   *
   * Aucune ligne ⇒ aucune limite. C'est l'état de tous les revendeurs le jour
   * où la fonctionnalité arrive, et lire cette absence comme un zéro les
   * bloquerait tous d'un coup.
   */
  async quotaOf(userId: string): Promise<ResellerQuota> {
    const [row] = await this.db
      .select({
        memoryMb: resellerQuotas.memoryMb,
        diskMb: resellerQuotas.diskMb,
        serversMax: resellerQuotas.serversMax,
      })
      .from(resellerQuotas)
      .where(eq(resellerQuotas.userId, userId))
      .limit(1);

    return row ?? UNLIMITED_QUOTA;
  }

  /**
   * Ce que le revendeur consomme déjà.
   *
   * Une **union**, en une seule requête : un serveur compte s'il a été
   * provisionné sous ce revendeur *ou* s'il lui appartient en propre. Le `or`
   * fait que le serveur qui remplit les deux conditions n'est compté qu'une
   * fois ; deux requêtes additionnées le compteraient deux fois et
   * diviseraient l'enveloppe par deux sans que rien ne l'explique.
   */
  async usageOf(userId: string): Promise<QuotaUsage> {
    const { basis: _basis, unmeasured: _unmeasured, ...usage } = await this.usageDetailedOf(userId);
    return usage;
  }

  /**
   * La même lecture, avec la qualité de la mesure.
   *
   * **Une seule requête pour les deux usages**, et c'est délibéré : le refus à
   * la création et la coupure en cours de route doivent compter la même chose.
   * Deux requêtes finiraient par diverger sur la fenêtre de fraîcheur ou sur le
   * périmètre, et le jour où cela arrive, on refuse une commande à quelqu'un
   * qu'on ne coupe pas — ou l'inverse, ce qui est pire.
   */
  async usageDetailedOf(userId: string): Promise<QuotaUsageDetailed> {
    const [row] = await this.db
      .select({
        /*
         * La consommation **relevée**, et la limite en repli.
         *
         * Le plafond porte sur ce qui est réellement pris, pas sur la somme
         * des limites accordées : c'est ce qui rend la revente possible — on
         * vend plus qu'on ne détient tant que les clients n'utilisent pas
         * tout. Compter les limites interdirait ce modèle.
         *
         * Faute de relevé frais, on retombe sur la limite du serveur, qui
         * **majore** sa consommation. Jamais l'inverse : sous-estimer
         * laisserait dépasser un plafond sans que rien ne le voie.
         */
        memoryMb: sql<number>`coalesce(sum(coalesce(${LATEST_MEM_MB}, ${servers.memoryMb})), 0)::int`,
        diskMb: sql<number>`coalesce(sum(coalesce(${LATEST_DISK_MB}, ${servers.diskMb})), 0)::int`,
        servers: sql<number>`count(${servers.id})::int`,
        /*
         * Combien de serveurs n'ont aucun relevé frais.
         *
         * Le disque autant que la mémoire : un serveur à demi mesuré est déjà
         * une estimation, et la traiter comme une mesure serait s'autoriser à
         * couper sur une moitié de photo.
         */
        unmeasured: sql<number>`(count(*) filter (
          where ${LATEST_MEM_MB} is null or ${LATEST_DISK_MB} is null
        ))::int`,
      })
      .from(servers)
      /*
       * Le rattachement vient du serveur, plus de la machine.
       *
       * « Les serveurs d'un revendeur sont ceux qui tournent sur ses
       * machines » cesse d'être vrai dès qu'un dédié porte plusieurs
       * revendeurs. `servers.reseller_id` tranche, et le `or` couvre les
       * serveurs que le revendeur possède en propre.
       */
      .where(or(eq(servers.resellerId, userId), eq(servers.ownerId, userId)));

    if (!row) return { memoryMb: 0, diskMb: 0, servers: 0, basis: "measured", unmeasured: 0 };

    return {
      memoryMb: row.memoryMb,
      diskMb: row.diskMb,
      servers: row.servers,
      unmeasured: row.unmeasured,
      /*
       * Aucun serveur vaut « mesuré » : il n'y a rien dont la mesure manque.
       * Rendre `estimated` ferait passer un parc vide pour incertain, et le
       * surveillant s'interdirait d'agir sur un revendeur qui vient de tout
       * supprimer.
       */
      basis:
        row.servers === 0 || row.unmeasured === 0
          ? "measured"
          : row.unmeasured === row.servers
            ? "estimated"
            : "partial",
    };
  }

  async report(userId: string): Promise<ResellerQuotaReport> {
    const [quota, usage] = await Promise.all([this.quotaOf(userId), this.usageDetailedOf(userId)]);
    return { quota, usage };
  }

  /**
   * Refuse la création si elle ferait déborder l'enveloppe.
   *
   * Appelé pour le **revendeur auquel le serveur va se rattacher**, quel que
   * soit le demandeur — c'est `attributedReseller` qui le désigne. Ce qu'on lui
   * refuse est donc exactement ce qu'on lui comptera ensuite ; deux règles
   * différentes se tromperaient forcément d'un côté ou de l'autre.
   *
   * Ce n'était pas le propriétaire du node, comme on l'a longtemps écrit ici.
   * La nuance décide d'un cas entier : sur une **part** d'une machine de la
   * plateforme, le node n'appartient à personne, et viser son propriétaire
   * revenait à ne rien vérifier du tout. Un revendeur titulaire d'une part
   * n'avait alors aucune enveloppe à la création.
   *
   * Refuser est plus honnête que de laisser passer en silence : relever le
   * plafond est à un clic, et c'est une décision qui doit être prise, pas
   * subie.
   */
  async assertRoom(
    resellerId: string,
    requested: { memoryMb: number; diskMb: number },
  ): Promise<void> {
    const { quota, usage } = await this.report(resellerId);
    this.refuse(checkQuota(quota, usage, requested));
  }

  /**
   * Place pour **agrandir** un serveur déjà compté.
   *
   * Distinct de `assertRoom`, et la différence n'est pas un détail : un
   * agrandissement ne crée pas de serveur, donc il ne doit pas buter sur le
   * plafond du nombre — un revendeur au complet doit pouvoir faire monter un
   * client en gamme sans en supprimer un autre.
   *
   * Les écarts sont donnés tels quels, réductions comprises : rétrécir ne
   * demande rien, et se voir refuser une réduction parce qu'on est déjà au
   * plafond serait l'enfermement parfait.
   */
  async assertGrowth(
    resellerId: string,
    growth: { memoryMb: number; diskMb: number },
  ): Promise<void> {
    const { quota, usage } = await this.report(resellerId);
    this.refuse(checkQuotaGrowth(quota, usage, { ...growth, servers: 0 }));
  }

  /** Le refus commun, pour que les deux portes disent exactement la même chose. */
  private refuse(problems: ReturnType<typeof checkQuota>): void {
    if (problems.length === 0) return;

    const details = problems
      .map((problem) => {
        const label = QUOTA_DIMENSION_LABELS[problem.dimension];
        const unit = problem.dimension === "servers" ? "" : " Mo";
        return `${label} : ${problem.used}${unit} utilisés sur ${problem.limit}${unit}, demande de ${problem.requested}${unit}`;
      })
      .join(" ; ");

    throw new ConflictException(`Enveloppe de ressources dépassée — ${details}.`);
  }

  /**
   * Pose ou met à jour l'enveloppe d'un revendeur. Réservé à l'administration.
   *
   * `null` sur une dimension la rend illimitée : c'est ainsi qu'on **retire**
   * une limite, et le distinguer d'un champ absent évite qu'un formulaire vide
   * passe pour « aucune limite » alors qu'il voulait dire « ne change rien ».
   */
  async setQuota(userId: string, quota: ResellerQuota): Promise<void> {
    const [target] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target) throw new NotFoundException("Compte introuvable.");
    if (target.role !== "reseller") {
      // Une enveloppe sur un compte ordinaire ne serait jamais consultée : rien
      // ne la lirait, et elle donnerait l'illusion d'une limite en place.
      throw new ConflictException("Seul un compte revendeur dispose d'une enveloppe.");
    }

    await this.db
      .insert(resellerQuotas)
      .values({ userId, ...quota })
      .onConflictDoUpdate({
        target: resellerQuotas.userId,
        set: { ...quota, updatedAt: new Date().toISOString() },
      });
  }

  /** Enveloppes de tous les revendeurs, pour l'écran d'administration. */
  async all(): Promise<Record<string, ResellerQuota>> {
    const rows = await this.db
      .select({
        userId: resellerQuotas.userId,
        memoryMb: resellerQuotas.memoryMb,
        diskMb: resellerQuotas.diskMb,
        serversMax: resellerQuotas.serversMax,
      })
      .from(resellerQuotas);

    return Object.fromEntries(rows.map(({ userId, ...quota }) => [userId, quota]));
  }
}
