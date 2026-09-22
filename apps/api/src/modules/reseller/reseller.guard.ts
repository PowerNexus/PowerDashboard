import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SessionUser } from "../auth/session.repository";

/**
 * Accès à l'espace revendeur, appliqué **après** `SessionGuard`.
 *
 * Seul le rôle `reseller` passe — pas même un administrateur. Ce n'est pas une
 * hiérarchie oubliée : l'administration dispose de `/admin`, qui voit déjà tout
 * le parc. Ouvrir l'espace d'un revendeur à l'administration ferait une seconde
 * porte, moins bien gardée, vers les mêmes données, et brouillerait la question
 * à laquelle ce garde répond : « ce compte loue-t-il son propre matériel ? »
 *
 * Le refus est un 404 et non un 403, comme pour l'administration : répondre
 * « interdit » confirmerait l'existence de l'espace à qui n'y a pas accès.
 */
@Injectable()
export class ResellerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: SessionUser;
      scopes?: string[] | null;
    }>();

    /**
     * Une clé d'API n'entre pas non plus.
     *
     * Ses portées décrivent des permissions **de serveur** ; aucune ne parle de
     * la gestion d'un parc. Une clé du compte d'un revendeur hériterait donc de
     * tout, sans qu'aucune case ne l'ait accordé.
     */
    if (request.scopes != null) throw new NotFoundException();

    if (request.user?.role === "reseller") return true;
    throw new NotFoundException();
  }
}
