import {
  allocations,
  type Database,
  eggs,
  eggVariables,
  locations,
  nests,
  nodeResellerShares,
  nodes,
  servers,
  settings,
} from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, exists, isNull, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

export interface CatalogueVariable {
  envVariable: string;
  name: string;
  description: string | null;
  defaultValue: string;
  isEditable: boolean;
}

export interface CatalogueGame {
  eggId: string;
  name: string;
  nest: string;
  description: string | null;
  /** Mémoire minimale conseillée, tirée du plan le plus petit qui convienne. */
  minMemoryMb: number;
  /** Variables que le client peut renseigner à la création. */
  variables: CatalogueVariable[];
}

export interface CataloguePlan {
  id: string;
  name: string;
  memoryMb: number;
  diskMb: number;
  cpuPct: number;
  swapMb: number;
  backups: number;
  databases: number;
  allocations: number;
  priceLabel: string;
}

export interface CatalogueLocation {
  id: string;
  short: string;
  long: string;
  countryCode: string;
  /** Ports libres sur les nodes publics de cette localisation. */
  availablePorts: number;
  /** Faux quand aucun node n'y est disponible : l'écran doit pouvoir le griser. */
  isAvailable: boolean;
}

/**
 * Node proposé à qui a le droit de le désigner.
 *
 * La capacité rendue est celle qui **reste**, sur-allocation comprise : c'est
 * la seule qui permette de décider. Afficher la capacité totale ferait proposer
 * 128 Go sur un node qui n'en a plus que deux.
 */
export interface CatalogueNode {
  id: string;
  name: string;
  locationId: string;
  locationShort: string;
  /** `null` pour un node de la plateforme, sinon le revendeur propriétaire. */
  ownerId: string | null;
  maintenanceMode: boolean;
  freeMemoryMb: number;
  freeDiskMb: number;
  cpuCores: number;
  freePorts: number;
}

/**
 * Clé du catalogue d'offres dans la table `settings`.
 *
 * Les offres n'ont pas de table dédiée, et c'est délibéré : la facturation est
 * externe au panel (§7.1, `servers.external_id`). Le jour où elle sera
 * branchée, cette liste viendra d'elle. En attendant, elle vit côté serveur et
 * non dans le code du navigateur — un client ne doit pas pouvoir demander une
 * offre qu'on ne lui propose pas.
 */
export const PLANS_SETTING_KEY = "catalogue.plans";

/**
 * Offres par défaut, servies tant que rien n'est enregistré.
 *
 * Elles ne sont pas « les vraies offres » : c'est un jeu de valeurs cohérent
 * pour que l'assistant fonctionne avant la facturation. Le libellé de prix le
 * dit.
 */
const DEFAULT_PLANS: CataloguePlan[] = [
  {
    id: "decouverte",
    name: "Découverte",
    memoryMb: 2048,
    diskMb: 10_240,
    cpuPct: 100,
    swapMb: 0,
    backups: 2,
    databases: 1,
    allocations: 1,
    priceLabel: "Tarif à définir",
  },
  {
    id: "communaute",
    name: "Communauté",
    memoryMb: 4096,
    diskMb: 25_600,
    cpuPct: 200,
    swapMb: 0,
    backups: 5,
    databases: 2,
    allocations: 3,
    priceLabel: "Tarif à définir",
  },
  {
    id: "performance",
    name: "Performance",
    memoryMb: 8192,
    diskMb: 51_200,
    cpuPct: 400,
    swapMb: 1024,
    backups: 10,
    databases: 4,
    allocations: 5,
    priceLabel: "Tarif à définir",
  },
];

@Injectable()
export class CatalogueService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Jeux proposés.
   *
   * Seuls les eggs **activés** sont servis : un egg importé mais non validé par
   * un administrateur ne doit pas apparaître, sous peine de créer des serveurs
   * avec un script d'installation que personne n'a relu (§8.3).
   */
  async games(): Promise<CatalogueGame[]> {
    const rows = await this.db
      .select({
        eggId: eggs.id,
        name: eggs.name,
        description: eggs.description,
        nest: nests.name,
      })
      .from(eggs)
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .where(eq(eggs.enabled, true));

    if (rows.length === 0) return [];

    const variables = await this.db
      .select({
        eggId: eggVariables.eggId,
        envVariable: eggVariables.envVariable,
        name: eggVariables.name,
        description: eggVariables.description,
        defaultValue: eggVariables.defaultValue,
        isEditable: eggVariables.userEditable,
        isViewable: eggVariables.userViewable,
      })
      .from(eggVariables);

    const smallest = (await this.plans()).reduce(
      (min, plan) => Math.min(min, plan.memoryMb),
      Number.POSITIVE_INFINITY,
    );

    return rows.map((row) => ({
      eggId: row.eggId,
      name: row.name,
      nest: row.nest,
      description: row.description,
      minMemoryMb: Number.isFinite(smallest) ? smallest : 1024,
      variables: variables
        // Les variables invisibles ne sont pas proposées : elles portent les
        // secrets de l'egg, que le panel renseigne lui-même à la création.
        .filter((v) => v.eggId === row.eggId && v.isViewable && v.isEditable)
        .map((v) => ({
          envVariable: v.envVariable,
          name: v.name,
          description: v.description,
          defaultValue: v.defaultValue,
          isEditable: v.isEditable,
        })),
    }));
  }

  /** Offres. Lues depuis `settings`, avec un repli documenté. */
  async plans(): Promise<CataloguePlan[]> {
    const [row] = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, PLANS_SETTING_KEY))
      .limit(1);

    const stored = row?.value;
    if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_PLANS;
    return stored as CataloguePlan[];
  }

  /**
   * Localisations, avec leur disponibilité réelle.
   *
   * Une localisation sans port libre est renvoyée quand même, marquée
   * indisponible : la faire disparaître donnerait l'impression qu'elle n'existe
   * pas, alors qu'elle est simplement pleine — et ce sont deux conversations
   * différentes avec le support.
   */
  async locations(): Promise<CatalogueLocation[]> {
    const rows = await this.db
      .select({
        id: locations.id,
        short: locations.short,
        long: locations.long,
        countryCode: locations.countryCode,
        availablePorts: sql<number>`count(${allocations.id}) filter (
          where ${allocations.serverId} is null
        )::int`,
      })
      .from(locations)
      .leftJoin(
        nodes,
        and(
          eq(nodes.locationId, locations.id),
          eq(nodes.public, true),
          // Un node attribué à un revendeur sort du catalogue public : sa
          // capacité est la sienne, et un client ordinaire n'a pas à y atterrir
          // parce que le répartiteur l'a trouvé libre.
          isNull(nodes.ownerId),
          eq(nodes.maintenanceMode, false),
        ),
      )
      .leftJoin(allocations, eq(allocations.nodeId, nodes.id))
      .groupBy(locations.id, locations.short, locations.long, locations.countryCode);

    return rows.map((row) => ({
      ...row,
      isAvailable: row.availablePorts > 0,
    }));
  }

  /**
   * Nodes qu'un compte a le droit de désigner.
   *
   * Un administrateur les voit tous. Un revendeur voit **ses machines et ses
   * parts** : il loue du matériel — une machine entière, ou une tranche sur un
   * dédié partagé — il provisionne dessus, et il n'a rien à faire sur celui des
   * autres. Tout autre rôle n'en désigne aucun : le panel choisit pour lui.
   *
   * **La part comptait pour rien jusqu'ici.** La condition ne regardait que le
   * propriétaire du node, si bien qu'un revendeur à qui l'administration avait
   * découpé une tranche voyait « aucune machine ne vous est attribuée » — alors
   * que sa part existait, était facturée, et s'affichait dans son propre
   * espace. Les deux titres ouvrent le même droit : provisionner ici.
   *
   * Les nodes en maintenance sont rendus **marqués** plutôt qu'écartés : leur
   * absence se lirait comme une disparition, et celui qui les a mis en
   * maintenance est souvent celui qui regarde cette liste.
   */
  async nodesFor(user: { id: string; role: string }): Promise<CatalogueNode[]> {
    if (user.role !== "admin" && user.role !== "reseller") return [];

    const rows = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        locationId: nodes.locationId,
        locationShort: locations.short,
        ownerId: nodes.ownerId,
        maintenanceMode: nodes.maintenanceMode,
        memoryMb: nodes.memoryMb,
        memoryOverallocate: nodes.memoryOverallocate,
        diskMb: nodes.diskMb,
        diskOverallocate: nodes.diskOverallocate,
        cpuCores: nodes.cpuCores,
        usedMemory: sql<number>`coalesce(sum(${servers.memoryMb}), 0)::int`,
        usedDisk: sql<number>`coalesce(sum(${servers.diskMb}), 0)::int`,
      })
      .from(nodes)
      .innerJoin(locations, eq(nodes.locationId, locations.id))
      .leftJoin(servers, eq(servers.nodeId, nodes.id))
      .where(
        user.role === "admin"
          ? undefined
          : or(
              eq(nodes.ownerId, user.id),
              // La part est cherchée par une sous-requête plutôt que par une
              // jointure : une jointure multiplierait les lignes du node par
              // ses parts, et les sommes de consommation ci-dessus compteraient
              // chaque serveur autant de fois qu'il y a de revendeurs dessus.
              exists(
                this.db
                  .select({ one: sql`1` })
                  .from(nodeResellerShares)
                  .where(
                    and(
                      eq(nodeResellerShares.nodeId, nodes.id),
                      eq(nodeResellerShares.resellerId, user.id),
                    ),
                  ),
              ),
            ),
      )
      .groupBy(
        nodes.id,
        nodes.name,
        nodes.locationId,
        locations.short,
        nodes.ownerId,
        nodes.maintenanceMode,
        nodes.memoryMb,
        nodes.memoryOverallocate,
        nodes.diskMb,
        nodes.diskOverallocate,
        nodes.cpuCores,
      );

    /*
     * Les parts de ce revendeur, pour borner ce qu'on lui montre.
     *
     * Sur une machine partagée, la capacité annoncée est **la sienne** et non
     * celle du matériel. Deux raisons, et la seconde suffirait : lui montrer
     * 128 Go sur une tranche de 8 l'inviterait à vendre seize fois trop, et la
     * consommation totale de la machine lui apprendrait l'activité de ses
     * concurrents.
     */
    const shares = new Map<
      string,
      { memoryMb: number; diskMb: number; usedMemory: number; usedDisk: number }
    >();
    if (user.role === "reseller") {
      const rowsOfShares = await this.db
        .select({
          nodeId: nodeResellerShares.nodeId,
          memoryMb: nodeResellerShares.memoryMb,
          diskMb: nodeResellerShares.diskMb,
          // Sa consommation à lui sur cette machine : les serveurs des autres
          // revendeurs n'entament pas sa part.
          usedMemory: sql<number>`coalesce(sum(${servers.memoryMb}) filter (
            where ${servers.ownerId} = ${user.id}
          ), 0)::int`,
          usedDisk: sql<number>`coalesce(sum(${servers.diskMb}) filter (
            where ${servers.ownerId} = ${user.id}
          ), 0)::int`,
        })
        .from(nodeResellerShares)
        .leftJoin(servers, eq(servers.nodeId, nodeResellerShares.nodeId))
        .where(eq(nodeResellerShares.resellerId, user.id))
        .groupBy(nodeResellerShares.nodeId, nodeResellerShares.memoryMb, nodeResellerShares.diskMb);

      for (const share of rowsOfShares) shares.set(share.nodeId, share);
    }

    return Promise.all(
      rows.map(async (row) => {
        const [free] = await this.db
          .select({ n: count() })
          .from(allocations)
          .where(and(eq(allocations.nodeId, row.id), isNull(allocations.serverId)));

        /*
         * La part l'emporte sur la machine, quand il y en a une.
         *
         * Sans sur-allocation : elle est un réglage de la machine, décidé par
         * la plateforme, et l'appliquer à une tranche reviendrait à vendre au
         * revendeur davantage que ce qu'on lui a découpé.
         */
        const share = shares.get(row.id);
        const memoryCap = share
          ? share.memoryMb
          : row.memoryMb * (1 + row.memoryOverallocate / 100);
        const diskCap = share ? share.diskMb : row.diskMb * (1 + row.diskOverallocate / 100);
        const usedMemory = share ? share.usedMemory : row.usedMemory;
        const usedDisk = share ? share.usedDisk : row.usedDisk;

        return {
          id: row.id,
          name: row.name,
          locationId: row.locationId,
          locationShort: row.locationShort,
          ownerId: row.ownerId,
          maintenanceMode: row.maintenanceMode,
          // Un node sur-alloué au-delà de sa capacité rendrait un nombre
          // négatif, que l'écran afficherait tel quel. Zéro dit la même chose
          // sans laisser croire à une erreur de calcul.
          freeMemoryMb: Math.max(0, Math.floor(memoryCap - usedMemory)),
          freeDiskMb: Math.max(0, Math.floor(diskCap - usedDisk)),
          cpuCores: row.cpuCores,
          freePorts: free?.n ?? 0,
        };
      }),
    );
  }

  /**
   * Capacité restante d'un node donné, pour la validation à la création.
   *
   * Relue au moment de créer et non reprise de la liste affichée : entre le
   * chargement du formulaire et l'envoi, quelqu'un d'autre a pu remplir le
   * node. La liste sert à choisir, celle-ci à décider.
   */
  async nodeCapacity(
    nodeId: string,
    /**
     * Pour qui la capacité est évaluée.
     *
     * **Le demandeur, et non l'administration.** Cette méthode servait à
     * valider une création en se plaçant en administrateur : elle rendait donc
     * la capacité de la **machine**, et un revendeur titulaire d'une tranche
     * de 8 Go était validé contre les 128 Go du matériel. Elle rendait aussi
     * un node que le demandeur n'a pas le droit de désigner, si bien que le
     * contrôle d'accès devait le refaire à côté — et le refaisait mal, en ne
     * regardant que la propriété.
     *
     * En passant le demandeur, `nodesFor` répond aux deux questions à la fois :
     * « a-t-il le droit d'aller là » et « combien lui reste-t-il ». Une seule
     * règle, au lieu de deux qui divergent.
     */
    requester: { id: string; role: string },
  ): Promise<CatalogueNode | null> {
    const candidates = await this.nodesFor(requester);
    return candidates.find((node) => node.id === nodeId) ?? null;
  }

  /**
   * Node retenu dans une localisation, ou `null`.
   *
   * Choisi par le panel et jamais par le client : le laisser désigner un node
   * lui permettrait de viser celui qui héberge un serveur qu'il convoite, ou
   * de contourner la mise en maintenance.
   *
   * Le critère est la place restante en mémoire, sur-allocation comprise. Un
   * node est écarté dès qu'il n'a plus de port libre — sans port, un serveur
   * n'a pas d'adresse et ne peut pas exister.
   */
  /**
   * Même répartition, mais dans le parc d'un **revendeur**.
   *
   * `pickNode` ne considère que les nodes publics de la plateforme : c'est
   * exact pour un client du panel, et faux dès que la commande vient de la
   * boutique d'un revendeur — elle atterrirait sur du matériel qui n'est pas le
   * sien, facturé par lui, hébergé par nous.
   *
   * Les candidats viennent de `nodesFor`, qui connaît déjà ses machines **et**
   * ses parts sur celles de la plateforme. Réécrire ce filtre ici l'aurait fait
   * diverger du jour où une troisième façon d'accéder à un node existera.
   */
  async pickNodeForReseller(
    resellerId: string,
    locationId: string,
    memoryMb: number,
    diskMb: number,
  ): Promise<string | null> {
    const candidates = (await this.nodesFor({ id: resellerId, role: "reseller" }))
      .filter(
        (node) =>
          node.locationId === locationId &&
          !node.maintenanceMode &&
          node.freeMemoryMb >= memoryMb &&
          node.freeDiskMb >= diskMb &&
          // Sans port libre, un serveur n'a pas d'adresse et ne peut pas exister.
          node.freePorts > 0,
      )
      // Le plus de mémoire restante d'abord : même critère que `pickNode`, pour
      // que deux commandes identiques ne se placent pas différemment selon
      // qu'elles viennent de la plateforme ou d'une boutique.
      .sort((a, b) => b.freeMemoryMb - a.freeMemoryMb);

    return candidates[0]?.id ?? null;
  }

  async pickNode(locationId: string, memoryMb: number, diskMb: number): Promise<string | null> {
    const candidates = await this.db
      .select({
        id: nodes.id,
        memoryMb: nodes.memoryMb,
        memoryOverallocate: nodes.memoryOverallocate,
        diskMb: nodes.diskMb,
        diskOverallocate: nodes.diskOverallocate,
        usedMemory: sql<number>`coalesce(sum(${servers.memoryMb}), 0)::int`,
        usedDisk: sql<number>`coalesce(sum(${servers.diskMb}), 0)::int`,
      })
      .from(nodes)
      .leftJoin(servers, eq(servers.nodeId, nodes.id))
      .where(
        and(
          eq(nodes.locationId, locationId),
          eq(nodes.public, true),
          // Un node attribué à un revendeur sort du catalogue public : sa
          // capacité est la sienne, et un client ordinaire n'a pas à y atterrir
          // parce que le répartiteur l'a trouvé libre.
          isNull(nodes.ownerId),
          eq(nodes.maintenanceMode, false),
        ),
      )
      .groupBy(
        nodes.id,
        nodes.memoryMb,
        nodes.memoryOverallocate,
        nodes.diskMb,
        nodes.diskOverallocate,
      );

    const withPorts = await Promise.all(
      candidates.map(async (node) => {
        const [free] = await this.db
          .select({ n: count() })
          .from(allocations)
          .where(and(eq(allocations.nodeId, node.id), isNull(allocations.serverId)));
        return { ...node, freePorts: free?.n ?? 0 };
      }),
    );

    const fitting = withPorts.filter((node) => {
      if (node.freePorts === 0) return false;
      const memoryCap = node.memoryMb * (1 + node.memoryOverallocate / 100);
      const diskCap = node.diskMb * (1 + node.diskOverallocate / 100);
      return node.usedMemory + memoryMb <= memoryCap && node.usedDisk + diskMb <= diskCap;
    });

    if (fitting.length === 0) return null;

    // Le plus libre l'emporte : répartir plutôt que remplir un node jusqu'au
    // bord, pour qu'une panne touche moins de monde à la fois.
    return fitting.reduce((best, node) =>
      node.memoryMb - node.usedMemory > best.memoryMb - best.usedMemory ? node : best,
    ).id;
  }
}
