import type { Branding } from "@gamedashboard/contracts";
import { Controller, Get, Headers, Inject, Query } from "@nestjs/common";
import { BrandingService } from "./branding.service";

/**
 * Résolution de la marque, sans session.
 *
 * **Publique et sans authentification**, parce qu'elle sert la page de
 * connexion : la marque doit être en place avant que quiconque se connecte,
 * sinon un client d'un revendeur verrait la marque de la plateforme le temps de
 * saisir son mot de passe — précisément l'écran qui doit le rassurer.
 *
 * Elle ne révèle que ce qui est déjà affiché à qui ouvre l'adresse : un nom, un
 * logo, une couleur.
 *
 * **Un seul vhost sert tous les domaines.** Le panel ne demande pas un serveur
 * web par revendeur : l'hôte de la requête voyage jusqu'ici et décide de la
 * marque. C'est ce qui permet d'ajouter un domaine sans toucher à la
 * configuration du serveur — le revendeur publie son CNAME, vérifie, et son
 * domaine est servi à la requête suivante.
 */
@Controller("api/v1/branding")
export class BrandingController {
  constructor(@Inject(BrandingService) private readonly branding: BrandingService) {}

  /**
   * L'hôte est **transmis explicitement** par la couche web.
   *
   * L'API ne voit pas l'hôte du navigateur : c'est Next qui l'appelle, et elle
   * lirait son propre `Host`. Le paramètre est donc la seule source possible.
   *
   * Rien ici n'est une décision de sécurité : un hôte falsifié ne donne que la
   * marque d'un revendeur — un logo et une couleur — jamais un accès. Les
   * routes qui décident de quelque chose lisent la session, jamais cet en-tête.
   */
  @Get()
  async resolve(
    @Query("host") host?: string,
    @Headers("x-gd-host") forwarded?: string,
  ): Promise<{ data: Branding }> {
    return { data: await this.branding.forHost(host ?? forwarded ?? null) };
  }
}
