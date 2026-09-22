import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";

/**
 * Routes réservées à une session ouverte dans un navigateur.
 *
 * Deux raisons de fermer la porte aux clés d'API, et la seconde suffirait :
 *
 * 1. Les portées d'une clé décrivent des permissions **de serveur**. Aucune ne
 *    parle de la sécurité du compte. Laisser passer une clé lui donnerait donc
 *    le droit de fermer les sessions de son propriétaire sans qu'aucune case
 *    ne l'ait accordé — et une clé volée couperait l'accès au panel avant
 *    qu'on ait pu la révoquer.
 * 2. Ces routes se lisent par rapport à « cette session-ci » : la marquer dans
 *    la liste, l'épargner d'une révocation générale. Une clé n'en a pas. Elle
 *    révoquerait donc tout, y compris la session depuis laquelle on regarde.
 *
 * S'emploie **après** `SessionGuard`, qui pose `scopes` sur la requête.
 */
@Injectable()
export class BrowserSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ scopes?: string[] | null }>();

    // `null` signale une session de navigateur ; toute autre valeur, une clé.
    if (request.scopes != null) {
      throw new ForbiddenException(
        "Les clés d'API ne peuvent pas gérer les sessions du compte. Connectez-vous au panel.",
      );
    }
    return true;
  }
}
