import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { SessionUser } from "../auth/session.repository";

/**
 * Écriture dans l'espace d'administration : **administrateurs seulement**.
 *
 * `AdminGuard` laisse aussi passer le support, et c'est voulu pour la lecture :
 * répondre à un client demande de voir ses serveurs. Supprimer un compte,
 * suspendre un serveur ou changer la configuration SMTP n'en fait pas partie.
 *
 * Deux gardes plutôt qu'un test dans chaque route : le jour où un rôle
 * s'ajoute, il n'y a qu'un endroit à relire pour savoir ce qu'il peut écrire.
 *
 * Le refus est ici un 403 et non un 404, contrairement à `AdminGuard` : la
 * personne a déjà accès à l'espace et sait qu'il existe. Lui répondre
 * « introuvable » sur une route qu'elle voit à l'écran serait une énigme, pas
 * une protection.
 */
const WRITE_ROLES = new Set(["admin"]);

@Injectable()
export class AdminWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: SessionUser;
      scopes?: string[] | null;
    }>();

    /**
     * Une clé d'API ne peut rien écrire ici.
     *
     * Ses portées décrivent des permissions **de serveur** : aucune ne parle
     * d'administration de la plateforme. Une clé du compte d'un administrateur
     * hériterait donc de tout, sans qu'aucune case ne l'ait accordé.
     */
    if (request.scopes != null) {
      throw new ForbiddenException(
        "Les clés d'API ne peuvent pas administrer la plateforme. Connectez-vous au panel.",
      );
    }

    if (request.user !== undefined && WRITE_ROLES.has(request.user.role)) return true;
    throw new ForbiddenException("Cette action demande le rôle administrateur.");
  }
}
