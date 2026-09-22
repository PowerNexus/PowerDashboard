import { randomBytes } from "node:crypto";
import { encryptSecret } from "@gamedashboard/auth";
import {
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
import { asc, count, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

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

    const [created] = await this.db
      .insert(nodes)
      .values({
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
        daemonTokenEnc: encryptSecret(token),
        daemonTokenRotatedAt: new Date().toISOString(),
      })
      .returning({ id: nodes.id });

    if (!created) throw new ConflictException("Le node n'a pas pu être créé.");
    return { id: created.id, tokenId, token };
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
