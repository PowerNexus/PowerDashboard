import { randomBytes, randomUUID } from "node:crypto";
import {
  type CapacityRefusal,
  capacityRefusals,
  type NodeSettingsInput,
} from "@gamedashboard/contracts";
import {
  allocations,
  type Database,
  locations,
  nodeCategories,
  nodeSubcategories,
  nodes,
  servers,
} from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { encryptRowSecret } from "../../common/row-secrets";

/**
 * Mise en place de l'infrastructure : classements, localisations, nodes.
 *
 * Trois choses distinctes, réunies ici parce qu'on ne peut créer un node sans
 * les deux autres — il lui faut une localisation, et un rangement pour ne pas
 * disparaître dans une liste plate.
 */

/** Un slug tenable dans une URL et lisible dans une requête SQL. */
function toSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

@Injectable()
export class InfrastructureService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /* --- Classement ---------------------------------------------------------- */

  /**
   * Le classement déclaré, avec le nombre de machines rangées sous chaque
   * intitulé.
   *
   * Le compte accompagne la catégorie parce que c'est la question qu'on se pose
   * en voulant en supprimer une : combien de nodes vais-je déclasser ?
   */
  async taxonomy() {
    const [categories, subcategories, perCategory, perSubcategory] = await Promise.all([
      this.db.select().from(nodeCategories).orderBy(asc(nodeCategories.position)),
      this.db
        .select()
        .from(nodeSubcategories)
        .orderBy(asc(nodeSubcategories.categoryId), asc(nodeSubcategories.position)),
      this.db.select({ key: nodes.category, n: count() }).from(nodes).groupBy(nodes.category),
      this.db.select({ key: nodes.subcategory, n: count() }).from(nodes).groupBy(nodes.subcategory),
    ]);

    const countOf = (rows: { key: string | null; n: number }[], key: string) =>
      rows.find((row) => row.key === key)?.n ?? 0;

    return {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        position: category.position,
        nodes: countOf(perCategory, category.id),
      })),
      subcategories: subcategories.map((subcategory) => ({
        id: subcategory.id,
        categoryId: subcategory.categoryId,
        name: subcategory.name,
        position: subcategory.position,
        nodes: countOf(perSubcategory, subcategory.id),
      })),
    };
  }

  async createCategory(input: { name: string; description?: string }): Promise<{ id: string }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Nommez la catégorie.");

    const id = toSlug(name);
    if (!id) throw new BadRequestException("Ce nom ne produit aucun identifiant utilisable.");

    const [existing] = await this.db
      .select({ id: nodeCategories.id })
      .from(nodeCategories)
      .where(eq(nodeCategories.id, id));
    if (existing) throw new ConflictException(`La catégorie « ${name} » existe déjà.`);

    const [last] = await this.db.select({ n: count() }).from(nodeCategories);

    await this.db.insert(nodeCategories).values({
      id,
      name,
      description: input.description?.trim() || null,
      position: last?.n ?? 0,
    });

    return { id };
  }

  /**
   * Supprime une catégorie.
   *
   * Les nodes qui la portaient ne sont **pas** modifiés : leur colonne garde le
   * slug, et l'affichage les range dans « Non classé ». Effacer la valeur du
   * node ferait perdre l'information au moment où l'on hésite encore — on
   * recrée souvent une catégorie qu'on vient de supprimer par erreur, et elle
   * retrouve alors ses machines.
   */
  async removeCategory(categoryId: string): Promise<{ orphanedNodes: number }> {
    const [affected] = await this.db
      .select({ n: count() })
      .from(nodes)
      .where(eq(nodes.category, categoryId));

    const [deleted] = await this.db
      .delete(nodeCategories)
      .where(eq(nodeCategories.id, categoryId))
      .returning({ id: nodeCategories.id });

    if (!deleted) throw new NotFoundException("Catégorie inconnue.");
    return { orphanedNodes: affected?.n ?? 0 };
  }

  async createSubcategory(input: { categoryId: string; name: string }): Promise<{ id: string }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Nommez la sous-catégorie.");

    const [parent] = await this.db
      .select({ id: nodeCategories.id })
      .from(nodeCategories)
      .where(eq(nodeCategories.id, input.categoryId));
    if (!parent) throw new BadRequestException("Catégorie parente inconnue.");

    // Le slug est préfixé par sa catégorie : deux catégories peuvent avoir une
    // sous-catégorie « Gravelines », et les identifiants doivent rester
    // distincts sans que l'administrateur ait à y penser.
    const id = `${input.categoryId}-${toSlug(name)}`.slice(0, 60);

    const [existing] = await this.db
      .select({ id: nodeSubcategories.id })
      .from(nodeSubcategories)
      .where(eq(nodeSubcategories.id, id));
    if (existing) throw new ConflictException(`La sous-catégorie « ${name} » existe déjà ici.`);

    const [siblings] = await this.db
      .select({ n: count() })
      .from(nodeSubcategories)
      .where(eq(nodeSubcategories.categoryId, input.categoryId));

    await this.db
      .insert(nodeSubcategories)
      .values({ id, categoryId: input.categoryId, name, position: siblings?.n ?? 0 });

    return { id };
  }

  async removeSubcategory(subcategoryId: string): Promise<{ orphanedNodes: number }> {
    const [affected] = await this.db
      .select({ n: count() })
      .from(nodes)
      .where(eq(nodes.subcategory, subcategoryId));

    const [deleted] = await this.db
      .delete(nodeSubcategories)
      .where(eq(nodeSubcategories.id, subcategoryId))
      .returning({ id: nodeSubcategories.id });

    if (!deleted) throw new NotFoundException("Sous-catégorie inconnue.");
    return { orphanedNodes: affected?.n ?? 0 };
  }

  /* --- Localisations ------------------------------------------------------- */

  async listLocations() {
    return this.db.select().from(locations).orderBy(asc(locations.short));
  }

  async createLocation(input: {
    short: string;
    long: string;
    countryCode: string;
  }): Promise<{ id: string }> {
    const short = input.short.trim().toUpperCase();
    const long = input.long.trim();
    const countryCode = input.countryCode.trim().toUpperCase();

    if (!short || !long) throw new BadRequestException("Code court et libellé sont obligatoires.");
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      throw new BadRequestException("Le code pays tient en deux lettres (ISO 3166-1, « FR »).");
    }

    const [taken] = await this.db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.short, short));
    if (taken) throw new ConflictException(`La localisation « ${short} » existe déjà.`);

    const [created] = await this.db
      .insert(locations)
      .values({ short, long, countryCode })
      .returning({ id: locations.id });

    if (!created) throw new ConflictException("La localisation n'a pas pu être créée.");
    return { id: created.id };
  }

  async removeLocation(locationId: string): Promise<void> {
    // La contrainte en base est `restrict` ; la vérifier ici permet de dire
    // combien de machines bloquent, et donc quoi faire.
    const [used] = await this.db
      .select({ n: count() })
      .from(nodes)
      .where(eq(nodes.locationId, locationId));

    if ((used?.n ?? 0) > 0) {
      throw new ConflictException(
        `${used?.n} node(s) s'y trouvent encore. Déplacez-les avant de supprimer la localisation.`,
      );
    }

    await this.db.delete(locations).where(eq(locations.id, locationId));
  }

  /* --- Nodes --------------------------------------------------------------- */

  /**
   * Déclare une machine.
   *
   * Le jeton du daemon est tiré ici et rendu **une seule fois** : c'est lui
   * qu'on recopie dans la configuration de Wings. Seule sa forme chiffrée est
   * gardée — le panel doit pouvoir le relire pour parler au daemon, ce qui
   * interdit de le condenser comme un mot de passe, mais rien n'oblige à le
   * réafficher.
   *
   * Le node est créé **sans allocation** : les ports s'ajoutent ensuite, par
   * plages, depuis la fiche. Les demander ici ferait un formulaire de quinze
   * champs pour une information qu'on ajuste souvent après coup.
   */
  async createNode(input: {
    name: string;
    locationId: string;
    category: string | null;
    subcategory: string | null;
    fqdn: string;
    scheme: string;
    daemonPort: number;
    daemonSftpPort: number;
    memoryMb: number;
    diskMb: number;
    cpuCores: number;
    isPublic: boolean;
  }): Promise<{ id: string; tokenId: string; token: string }> {
    const name = input.name.trim();
    const fqdn = input.fqdn.trim().toLowerCase();

    if (!name) throw new BadRequestException("Nommez le node.");
    /*
     * Le nom de domaine est exigé, et une adresse IP ne suffit pas.
     *
     * Wings est joint en HTTPS et présente un certificat ; une IP nue produit
     * un certificat invalide et un daemon qui paraît injoignable sans qu'on
     * comprenne pourquoi. En HTTP — un poste de développement — la contrainte
     * n'a pas lieu d'être.
     */
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(fqdn) && input.scheme === "https") {
      throw new BadRequestException(
        "Un nom de domaine est attendu en HTTPS : une adresse IP ne peut pas porter de certificat valide.",
      );
    }

    /*
     * `http` reste admis, et c'est un choix écrit (rapport ASVS, NC-56).
     *
     * Le jeton du node et chaque commande du panel voyagent alors en clair :
     * ce n'est acceptable que sur un poste de développement, où Wings tourne
     * sans certificat. Le refuser obligerait à monter une autorité de
     * certification pour le moindre essai ; le garder coûte un geste de
     * l'administrateur, seul à pouvoir le choisir, et le guide d'installation
     * le dit. Aucun filtre de destination non plus : un node vit par nature
     * sur le réseau de l'hébergeur, souvent en adresse privée.
     */
    if (input.scheme !== "http" && input.scheme !== "https") {
      throw new BadRequestException("Le schéma est « http » ou « https ».");
    }

    for (const [label, value] of [
      ["Mémoire", input.memoryMb],
      ["Disque", input.diskMb],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new BadRequestException(`${label} : un entier positif est attendu.`);
      }
    }
    if (!(input.cpuCores > 0)) {
      throw new BadRequestException("Cœurs : une valeur positive est attendue.");
    }

    const [location] = await this.db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, input.locationId));
    if (!location) throw new BadRequestException("Localisation inconnue.");

    /*
     * Le jeton est en deux morceaux, comme chez Wings.
     *
     * L'identifiant circule en clair — c'est lui qui désigne le node dans les
     * requêtes du daemon — et le secret l'authentifie. Les séparer permet de
     * retrouver la ligne sans avoir à comparer le secret, et donc d'indexer.
     */
    const tokenId = randomBytes(8).toString("hex");
    const token = randomBytes(32).toString("base64url");
    // Identifiant tiré ici : le jeton est lié à sa ligne dès l'écriture.
    const id = randomUUID();

    const [created] = await this.db
      .insert(nodes)
      .values({
        id,
        name,
        locationId: input.locationId,
        category: input.category,
        subcategory: input.subcategory,
        fqdn,
        scheme: input.scheme,
        daemonPort: input.daemonPort,
        daemonSftpPort: input.daemonSftpPort,
        memoryMb: input.memoryMb,
        diskMb: input.diskMb,
        cpuCores: input.cpuCores,
        public: input.isPublic,
        daemonTokenId: tokenId,
        daemonTokenEnc: encryptRowSecret("nodes.daemon_token_enc", id, token),
        daemonTokenRotatedAt: new Date().toISOString(),
      })
      .returning({ id: nodes.id });

    if (!created) throw new ConflictException("Le node n'a pas pu être créé.");
    return { id: created.id, tokenId, token };
  }

  /**
   * Fiche d'un node : tout ce que l'écran de modification présente.
   *
   * Le jeton n'en fait pas partie, ni en clair ni chiffré : il a sa propre
   * route, sous garde d'écriture et consignée au journal.
   */
  async nodeDetail(nodeId: string) {
    const [row] = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        locationId: nodes.locationId,
        category: nodes.category,
        subcategory: nodes.subcategory,
        fqdn: nodes.fqdn,
        scheme: nodes.scheme,
        daemonPort: nodes.daemonPort,
        daemonSftpPort: nodes.daemonSftpPort,
        memoryMb: nodes.memoryMb,
        memoryOverallocate: nodes.memoryOverallocate,
        diskMb: nodes.diskMb,
        diskOverallocate: nodes.diskOverallocate,
        cpuCores: nodes.cpuCores,
        isPublic: nodes.public,
        maintenance: nodes.maintenanceMode,
        ownerId: nodes.ownerId,
        wingsVersion: nodes.wingsVersion,
        lastHeartbeatAt: nodes.lastHeartbeatAt,
        unreachableSince: nodes.unreachableSince,
        tokenId: nodes.daemonTokenId,
        tokenRotatedAt: nodes.daemonTokenRotatedAt,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!row) throw new NotFoundException("Node introuvable.");

    // Renommés : `memoryMb` est la capacité de la machine, et l'allocation
    // posée par-dessus sous le même nom l'effaçait.
    const allocated = await this.allocatedOn(this.db, nodeId);
    return {
      ...row,
      memoryAllocatedMb: allocated.memoryMb,
      diskAllocatedMb: allocated.diskMb,
      servers: allocated.servers,
    };
  }

  /**
   * Modifie les réglages d'un node qui ne concernent que le panel.
   *
   * La liaison — adresse, protocole, ports — n'est **pas** ici : elle vit aussi
   * dans le `config.yml` de la machine, et passe par
   * `NodeConfigurationService.rebind`, qui ne l'enregistre qu'une fois le
   * daemon d'accord.
   *
   * **La capacité ne descend pas sous ce qui est promis.** Une limite vendue à
   * un client est un engagement ; réduire la machine en dessous ferait mentir
   * les jauges et laisserait le placement croire qu'un node plein a de la
   * place — ou l'inverse, le déclarer saturé à jamais. Le refus dit combien
   * manque, et quoi faire.
   *
   * Le node est verrouillé pendant la vérification : deux modifications
   * simultanées ne doivent pas se contredire après avoir chacune passé le
   * contrôle.
   */
  async updateNodeSettings(nodeId: string, input: NodeSettingsInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`select 1 from ${nodes} where ${nodes.id} = ${nodeId} for update`,
      );
      if (locked.length === 0) throw new NotFoundException("Node introuvable.");

      const [location] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.id, input.locationId));
      if (!location) throw new BadRequestException("Localisation inconnue.");

      const refusals = capacityRefusals(input, await this.allocatedOn(tx, nodeId));
      if (refusals.length > 0) throw new ConflictException(describeRefusals(refusals));

      await tx
        .update(nodes)
        .set({
          name: input.name,
          locationId: input.locationId,
          // Chaîne vide vaut « non classé » : un choix possible, pas un champ oublié.
          category: input.category || null,
          subcategory: input.category ? input.subcategory || null : null,
          memoryMb: input.memoryMb,
          memoryOverallocate: input.memoryOverallocate,
          diskMb: input.diskMb,
          diskOverallocate: input.diskOverallocate,
          cpuCores: input.cpuCores,
          public: input.isPublic,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(nodes.id, nodeId));
    });
  }

  /** Ce qui est accordé aux serveurs d'un node, en mémoire et en disque. */
  private async allocatedOn(
    db: Pick<Database, "select">,
    nodeId: string,
  ): Promise<{ memoryMb: number; diskMb: number; servers: number }> {
    const [row] = await db
      .select({
        memoryMb: sql<number>`coalesce(sum(${servers.memoryMb}), 0)::int`,
        diskMb: sql<number>`coalesce(sum(${servers.diskMb}), 0)::int`,
        servers: sql<number>`count(*)::int`,
      })
      .from(servers)
      .where(eq(servers.nodeId, nodeId));
    return row ?? { memoryMb: 0, diskMb: 0, servers: 0 };
  }

  /* --- Ports --------------------------------------------------------------- */

  /**
   * Le stock de ports d'un node, avec le serveur qui occupe chacun.
   *
   * Un port est « occupé » de deux façons, et il faut les deux : comme port
   * **principal** d'un serveur (`servers.allocation_id`), ou comme port
   * **supplémentaire** (`allocations.server_id`). Ne regarder que la seconde
   * présenterait comme libre le port sur lequel le serveur écoute.
   */
  async allocationsOf(nodeId: string) {
    const [node] = await this.db
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!node) throw new NotFoundException("Node introuvable.");

    return this.db
      .select({
        id: allocations.id,
        ip: allocations.ip,
        ipAlias: allocations.ipAlias,
        port: allocations.port,
        notes: allocations.notes,
        serverId: sql<string | null>`coalesce(${allocations.serverId}, ${servers.id})`,
        serverName: sql<string | null>`coalesce(
          (select s.name from ${servers} s where s.id = ${allocations.serverId}),
          ${servers.name}
        )`,
        isPrimary: sql<boolean>`${servers.id} is not null`,
      })
      .from(allocations)
      .leftJoin(servers, eq(servers.allocationId, allocations.id))
      .where(eq(allocations.nodeId, nodeId))
      .orderBy(asc(allocations.ip), asc(allocations.port));
  }

  /**
   * Retire des ports du stock d'un node.
   *
   * **Tout ou rien.** Si un seul des ports demandés est occupé par un serveur,
   * rien n'est retiré et le refus les nomme tous, avec le serveur qui les
   * tient. Retirer « ce qui pouvait l'être » laisserait l'administrateur
   * deviner lesquels sont partis ; le lui dire et le laisser décocher est plus
   * honnête.
   *
   * Un port occupé ne se retire jamais d'ici : le serveur y écoute, et le lui
   * arracher le rendrait injoignable au prochain démarrage. On le libère depuis
   * le serveur, ou en supprimant le serveur.
   *
   * Les lignes sont verrouillées le temps du contrôle : un serveur créé entre
   * la vérification et la suppression ne doit pas perdre le port qu'on vient
   * de lui attribuer.
   */
  async removeAllocations(nodeId: string, ids: string[]): Promise<{ removed: number }> {
    const unique = [...new Set(ids)];

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: allocations.id,
          ip: allocations.ip,
          port: allocations.port,
          extraOf: allocations.serverId,
        })
        .from(allocations)
        .where(and(eq(allocations.nodeId, nodeId), inArray(allocations.id, unique)))
        .for("update");

      if (rows.length !== unique.length) {
        throw new NotFoundException(
          "Certains ports demandés n'existent pas sur ce node (déjà retirés, ou d'une autre machine). Rechargez la liste.",
        );
      }

      const primaries = await tx
        .select({ allocationId: servers.allocationId, name: servers.name })
        .from(servers)
        .where(inArray(servers.allocationId, unique));
      const extras = await tx
        .select({ id: servers.id, name: servers.name })
        .from(servers)
        .where(
          inArray(
            servers.id,
            rows.flatMap((row) => (row.extraOf ? [row.extraOf] : [])),
          ),
        );

      const holder = (row: (typeof rows)[number]): string | null =>
        primaries.find((p) => p.allocationId === row.id)?.name ??
        extras.find((e) => e.id === row.extraOf)?.name ??
        null;

      const busy = rows.flatMap((row) => {
        const name = holder(row);
        return name === null ? [] : [`${row.ip}:${row.port} (${name})`];
      });
      if (busy.length > 0) {
        throw new ConflictException(
          `Rien n'a été retiré : ${busy.length === 1 ? "ce port est utilisé" : "ces ports sont utilisés"} par un serveur — ${busy.join(", ")}. Décochez-les, ou libérez-les depuis le serveur concerné, puis recommencez.`,
        );
      }

      const deleted = await tx
        .delete(allocations)
        .where(and(eq(allocations.nodeId, nodeId), inArray(allocations.id, unique)))
        .returning({ id: allocations.id });
      return { removed: deleted.length };
    });
  }

  /**
   * Retire une machine du parc.
   *
   * Refusé tant qu'elle héberge des serveurs : la contrainte existe en base,
   * mais elle produirait une erreur SQL illisible là où il faut dire combien de
   * serveurs bloquent.
   */
  async removeNode(nodeId: string): Promise<void> {
    const [hosted] = await this.db
      .select({ n: count() })
      .from(servers)
      .where(eq(servers.nodeId, nodeId));

    if ((hosted?.n ?? 0) > 0) {
      throw new ConflictException(
        `Ce node héberge ${hosted?.n} serveur(s). Transférez-les ou supprimez-les d'abord.`,
      );
    }

    const [deleted] = await this.db
      .delete(nodes)
      .where(eq(nodes.id, nodeId))
      .returning({ id: nodes.id });

    if (!deleted) throw new NotFoundException("Node introuvable.");
  }
}

/** Mégaoctets en clair, en gigaoctets dès que c'est plus lisible. */
function readableMb(mb: number): string {
  return mb >= 1024
    ? `${(mb / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`
    : `${mb} Mo`;
}

/**
 * Le refus d'une baisse de capacité, en une phrase qui dit quoi faire.
 *
 * Exportée pour être vérifiée : c'est le texte que l'administrateur lira, et
 * un chiffre inversé y serait une erreur de conduite, pas de style.
 */
export function describeRefusals(refusals: CapacityRefusal[]): string {
  const parts = refusals.map(
    (r) =>
      `${r.resource === "memory" ? "mémoire" : "disque"} : ${readableMb(r.capacityMb)} demandés (surallocation comprise), mais ${readableMb(r.allocatedMb)} sont déjà promis aux serveurs de cette machine`,
  );
  return `Capacité insuffisante — ${parts.join(" ; ")}. Gardez au moins ce qui est promis, augmentez la surallocation, ou déplacez des serveurs d'abord.`;
}
