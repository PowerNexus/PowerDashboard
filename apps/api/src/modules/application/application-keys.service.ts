import { generateApiKey, isAllowlistEntry } from "@gamedashboard/auth";
import {
  APPLICATION_KEY_MAX_DAYS,
  isApplicationScope,
  isPlatformScope,
} from "@gamedashboard/contracts";
import { applicationKeys, type Database, nodes, users } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Durée de vie d'une clé d'amorçage.
 *
 * Le temps d'ouvrir la fenêtre, de coller la commande dans un terminal et de
 * la lancer. Assez large pour ne pas courir, assez court pour qu'une clé
 * affichée puis oubliée ne vaille plus rien à la fin de la journée.
 */
const BOOTSTRAP_TTL_MS = 30 * 60_000;

export interface ApplicationKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  allowedIps: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Cycle de vie des clés applicatives, côté administration.
 *
 * Le secret n'est **jamais relu** : il est haché, pas chiffré. La différence
 * est le sujet même de cette classe. Un secret chiffré se déchiffre, donc une
 * fuite de la base le rend ; un condensat ne rend rien. Le prix est qu'une clé
 * perdue ne se retrouve pas — elle se remplace, ce qui est précisément ce
 * qu'on veut qu'il arrive.
 */
@Injectable()
export class ApplicationKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Les clés, toutes ou celles d'un revendeur.
   *
   * Le filtre est une **condition SQL** et non un tri après coup : un revendeur
   * qui verrait passer la liste entière avant qu'on la réduise aurait déjà les
   * préfixes et les dates d'usage des clés de la plateforme dans sa réponse, à
   * la moindre erreur de sérialisation.
   */
  async all(resellerId?: string): Promise<ApplicationKeySummary[]> {
    return this.db
      .select({
        id: applicationKeys.id,
        name: applicationKeys.name,
        prefix: applicationKeys.prefix,
        scopes: applicationKeys.scopes,
        allowedIps: applicationKeys.allowedIps,
        expiresAt: applicationKeys.expiresAt,
        lastUsedAt: applicationKeys.lastUsedAt,
        revokedAt: applicationKeys.revokedAt,
        createdAt: applicationKeys.createdAt,
      })
      .from(applicationKeys)
      .where(resellerId === undefined ? undefined : eq(applicationKeys.resellerId, resellerId))
      .orderBy(desc(applicationKeys.createdAt));
  }

  /**
   * Émet une clé. Le secret n'est montré qu'ici, et plus jamais.
   *
   * Une clé sans portée est refusée : elle passerait l'authentification et
   * échouerait sur chaque route, ce qui se diagnostique très mal depuis
   * l'autre côté du réseau.
   */
  async create(
    createdBy: string,
    input: {
      name: string;
      scopes: string[];
      allowedIps?: string[];
      expiresInDays?: number;
      resellerId?: string;
    },
  ): Promise<{ key: ApplicationKeySummary; plaintext: string }> {
    const name = input.name.trim();
    if (name === "")
      throw new BadRequestException("Nommez la clé : « Boutique », « Espace client ».");

    /*
     * Un revendeur ne s'accorde pas les portées de la plateforme.
     *
     * Elles ne lui serviraient d'ailleurs à rien — les routes concernées sont
     * marquées `@PlatformOnly` et refuseraient sa clé. Mais les accepter à
     * l'émission lui ferait croire qu'il les a, et le refus n'arriverait qu'au
     * premier appel, depuis son intégration, en production.
     */
    if (input.resellerId !== undefined && input.resellerId !== "") {
      const reservees = input.scopes.filter(isPlatformScope);
      if (reservees.length > 0) {
        throw new BadRequestException(
          `Ces portées relèvent de la plateforme et ne s'accordent pas à une clé de revendeur : ${reservees.join(", ")}.`,
        );
      }
    }

    const unknown = input.scopes.filter((scope) => !isApplicationScope(scope));
    if (unknown.length > 0) {
      throw new BadRequestException(`Portée inconnue : ${unknown.join(", ")}.`);
    }
    if (input.scopes.length === 0) {
      throw new BadRequestException("Accordez au moins une portée, sinon la clé ne sert à rien.");
    }

    /*
     * Le périmètre désigne un **revendeur**, et on le vérifie.
     *
     * Borner une clé à un compte client, ou à un identifiant inventé, la
     * rendrait simplement muette : elle ne verrait aucun serveur, donc aucun
     * client, et l'intégrateur passerait une heure à chercher pourquoi son
     * plugin ne trouve rien. Refuser tout de suite, en nommant la cause, coûte
     * une requête.
     */
    let resellerId: string | null = null;
    if (input.resellerId !== undefined && input.resellerId !== "") {
      const [compte] = await this.db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, input.resellerId))
        .limit(1);

      if (!compte) throw new BadRequestException("Ce revendeur n'existe pas.");
      if (compte.role !== "reseller") {
        throw new BadRequestException(
          "Une clé ne se borne qu'à un compte revendeur : bornée à un client, elle ne verrait rien.",
        );
      }
      resellerId = compte.id;
    }

    const allowedIps = (input.allowedIps ?? []).map((ip) => ip.trim()).filter((ip) => ip !== "");
    /*
     * La règle des clés personnelles, et non une expression régulière à part
     * (NC-37) : celle-ci refusait tout bloc CIDR, que la vérification à
     * l'usage sait pourtant comparer, et laissait passer `999.1.1.1` ou `:::`
     * — une clé alors inutilisable sans que rien ne dise pourquoi.
     */
    for (const ip of allowedIps) {
      if (!isAllowlistEntry(ip)) {
        throw new BadRequestException(
          `Adresse IP invalide : « ${ip} ». Une adresse, ou un bloc CIDR de préfixe non nul.`,
        );
      }
    }

    /**
     * L'échéance est obligatoire, et bornée à un an.
     *
     * Une clé de machine ne se retient pas de tête et ne change jamais d'elle-
     * même : sans date de fin, elle reste valable des années après le départ
     * du prestataire qui l'a intégrée.
     */
    const days = input.expiresInDays ?? APPLICATION_KEY_MAX_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > APPLICATION_KEY_MAX_DAYS) {
      throw new BadRequestException(`Validité entre 1 et ${APPLICATION_KEY_MAX_DAYS} jours.`);
    }

    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

    // Préfixe `gd_app_` : une clé applicative se reconnaît à l'œil nu dans un
    // journal ou un dépôt, sans avoir à la chercher en base pour savoir ce
    // qu'elle ouvre.
    const generated = generateApiKey("app");

    const [row] = await this.db
      .insert(applicationKeys)
      .values({
        name,
        prefix: generated.prefix,
        keyHash: generated.hash,
        scopes: [...new Set(input.scopes)],
        allowedIps,
        resellerId,
        createdBy,
        expiresAt,
      })
      .returning({
        id: applicationKeys.id,
        name: applicationKeys.name,
        prefix: applicationKeys.prefix,
        scopes: applicationKeys.scopes,
        allowedIps: applicationKeys.allowedIps,
        expiresAt: applicationKeys.expiresAt,
        lastUsedAt: applicationKeys.lastUsedAt,
        revokedAt: applicationKeys.revokedAt,
        createdAt: applicationKeys.createdAt,
      });

    if (!row) throw new BadRequestException("La clé n'a pas pu être créée.");
    return { key: row, plaintext: generated.plaintext };
  }

  /**
   * Émet une clé d'amorçage pour `wings configure`, sur un node précis.
   *
   * Elle existe pour qu'une mise en service ne demande pas de créer à la main
   * une clé permanente, qu'on oublierait ensuite de retirer. Trois bornes la
   * rendent négligeable si elle fuite :
   *
   * - **une seule portée**, `nodes.configure` ;
   * - **un seul node** — celui qu'on configure, et pas le parc ;
   * - **un seul usage**, et trente minutes de validité au plus.
   *
   * La précédente clé du même node est retirée : rouvrir la fenêtre ne doit
   * pas semer des clés valables derrière soi. Il en reste donc au plus une par
   * node, et elle porte le nom du node pour qu'on la reconnaisse dans la liste.
   */
  async issueForNode(
    createdBy: string,
    nodeId: string,
  ): Promise<{ plaintext: string; expiresAt: string }> {
    // Le nom vient de la base, jamais de l'appelant : il sert d'étiquette dans
    // la liste des clés, et une étiquette fournie par le client dirait ce
    // qu'on veut d'une clé qui, elle, est bien réelle.
    const [node] = await this.db
      .select({ id: nodes.id, name: nodes.name })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);

    if (!node) throw new NotFoundException("Node introuvable.");

    await this.db
      .update(applicationKeys)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        and(
          eq(applicationKeys.nodeId, node.id),
          isNull(applicationKeys.revokedAt),
          isNull(applicationKeys.consumedAt),
        ),
      );

    const expiresAt = new Date(Date.now() + BOOTSTRAP_TTL_MS).toISOString();
    const generated = generateApiKey("app");

    await this.db.insert(applicationKeys).values({
      name: `Mise en service — ${node.name}`,
      prefix: generated.prefix,
      keyHash: generated.hash,
      scopes: ["nodes.configure"],
      nodeId: node.id,
      singleUse: true,
      createdBy,
      expiresAt,
    });

    return { plaintext: generated.plaintext, expiresAt };
  }

  /**
   * Révoque une clé.
   *
   * La ligne est conservée : l'administration doit pouvoir constater qu'une
   * clé a bien été coupée, et à quel moment. Une suppression effacerait la
   * seule trace de ce qui a été retiré à qui.
   */
  /**
   * Révoque une clé.
   *
   * `resellerId` borne le geste : un revendeur ne révoque que les siennes. La
   * condition vit **dans la requête** plutôt que dans une lecture préalable —
   * lire puis écrire laisserait une fenêtre, et surtout deux endroits où la
   * règle pourrait diverger.
   *
   * Le refus emprunte le message de l'absence : distinguer « pas à vous » de
   * « n'existe pas » dirait à un revendeur que la clé d'un autre existe.
   */
  async revoke(keyId: string, resellerId?: string): Promise<void> {
    const [updated] = await this.db
      .update(applicationKeys)
      .set({ revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(
        resellerId === undefined
          ? eq(applicationKeys.id, keyId)
          : and(eq(applicationKeys.id, keyId), eq(applicationKeys.resellerId, resellerId)),
      )
      .returning({ id: applicationKeys.id });

    if (!updated) throw new NotFoundException("Clé introuvable.");
  }
}
