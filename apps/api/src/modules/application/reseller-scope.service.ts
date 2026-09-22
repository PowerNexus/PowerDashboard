import { type Database, servers, users } from "@gamedashboard/db";
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Le périmètre d'une clé applicative.
 *
 * Une clé portait des **portées sans périmètre** : elle disait ce qu'on pouvait
 * faire, jamais sur qui. Tant que la seule clé du panel était celle de
 * l'exploitant, cela suffisait. Dès qu'un revendeur branche sa propre boutique,
 * c'est l'inverse qui compte : il doit pouvoir créer et suspendre, mais
 * seulement chez lui.
 *
 * **Le rattachement se lit sur les serveurs**, parce que c'est là qu'il vit :
 * un compte n'appartient à personne, ce sont ses serveurs qui appartiennent à
 * un revendeur. « Ce client est à moi » se traduit donc par « ce client possède
 * au moins un serveur que j'héberge » — et non l'inverse, qui supposerait une
 * colonne que le modèle n'a pas et qui mentirait dès qu'un client achète
 * ailleurs.
 *
 * Conséquence assumée : **un compte tout neuf n'est à personne**. Une clé de
 * revendeur peut le créer — c'est ce que fait sa boutique à la commande — mais
 * ne peut ni le lire ni ouvrir sa session tant qu'il n'a pas de serveur chez
 * elle. C'est la bonne direction pour se tromper : on refuse trop, jamais trop
 * peu.
 */
@Injectable()
export class ResellerScopeService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Refuse si ce compte ne relève pas du périmètre de la clé.
   *
   * Une clé de plateforme (`resellerId` nul) passe sans contrôle : c'est son
   * rôle, et c'est le comportement qu'avaient toutes les clés jusqu'ici.
   *
   * Le message ne distingue pas « ce client n'existe pas » de « ce client n'est
   * pas à vous ». La distinction n'intéresse que celui qui cherche à savoir
   * qui sont les clients des autres revendeurs, et il n'a pas à l'apprendre
   * d'ici.
   */
  async requireUser(resellerId: string | null, userId: string): Promise<void> {
    if (resellerId === null) return;

    const [lien] = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.ownerId, userId), eq(servers.resellerId, resellerId)))
      .limit(1);

    if (!lien) {
      throw new NotFoundException("Compte introuvable.");
    }
  }

  /** Même règle pour un serveur : il doit être hébergé par ce revendeur. */
  async requireServer(resellerId: string | null, serverId: string): Promise<void> {
    if (resellerId === null) return;

    const [lien] = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.id, serverId), eq(servers.resellerId, resellerId)))
      .limit(1);

    if (!lien) {
      throw new NotFoundException("Serveur introuvable.");
    }
  }

  /**
   * Refuse tout net les routes qui n'ont pas de sens pour un revendeur.
   *
   * Les enveloppes de revente et la configuration d'un node relèvent de la
   * plateforme. Un revendeur qui pourrait poser sa propre enveloppe n'en aurait
   * plus ; un revendeur qui lirait la configuration d'un node repartirait avec
   * le jeton du daemon, c'est-à-dire avec la machine.
   */
  requirePlatform(resellerId: string | null, quoi: string): void {
    if (resellerId === null) return;
    throw new ForbiddenException(
      `Cette clé est bornée à un revendeur : ${quoi} relève de la plateforme.`,
    );
  }

  /**
   * Restreint une liste de serveurs au périmètre.
   *
   * Rendue comme condition SQL plutôt qu'en filtrant après coup : filtrer
   * ensuite laisse passer les compteurs, la pagination et les agrégats, qui
   * continuent de porter sur tout le parc. C'est le genre de fuite qui ne se
   * voit pas — on lit « 412 serveurs » sans remarquer qu'on n'en possède que
   * douze.
   */
  serverFilter(resellerId: string | null) {
    return resellerId === null ? undefined : eq(servers.resellerId, resellerId);
  }

  /**
   * Restreint une liste de comptes au périmètre.
   *
   * Un `exists` plutôt qu'une jointure : une jointure dupliquerait le compte
   * autant de fois qu'il a de serveurs chez ce revendeur.
   */
  userFilter(resellerId: string | null) {
    if (resellerId === null) return undefined;
    return sql`exists (
      select 1 from ${servers}
      where ${servers.ownerId} = ${users.id}
        and ${servers.resellerId} = ${resellerId}
    )`;
  }
}
