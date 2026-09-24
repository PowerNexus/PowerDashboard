import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { requestOrigin } from "../../common/request-origin";
import { DenialLogService } from "../activity/denial-log.service";
import type { SessionUser } from "../auth/session.repository";

/** Rôles autorisés à lire l'espace d'administration (§5.2). */
const ADMIN_ROLES = new Set(["admin", "support"]);

/**
 * Contrôle de rôle, appliqué **après** `SessionGuard`.
 *
 * Il ne relit pas le rôle en base : il lit celui que la session a résolu à
 * cette requête. C'est volontaire — un rôle retiré à un utilisateur prend effet
 * à sa requête suivante, sans qu'un cache intermédiaire puisse le garder actif.
 *
 * Le refus est un 404 et non un 403 : répondre « interdit » confirmerait
 * l'existence de l'espace d'administration et de ses routes à quelqu'un qui n'y
 * a pas accès. Il est pourtant consigné (NC-12) : un compte client qui essaie
 * les routes d'administration une à une ne laissait aucune trace.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(DenialLogService) private readonly denials: DenialLogService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: SessionUser;
      scopes?: string[] | null;
      ip?: string;
      method?: string;
      url?: string;
      routeOptions?: { url?: string };
    }>();

    /*
     * Une clé d'API n'entre pas ici, même en lecture. Ses portées décrivent des
     * permissions de serveur : aucune ne dit « lire l'administration », et une
     * clé restreinte du compte d'un administrateur lirait sinon tout le parc.
     * Même 404 qu'un rôle insuffisant : la clé ne doit rien apprendre.
     */
    if (
      request.scopes == null &&
      request.user !== undefined &&
      ADMIN_ROLES.has(request.user.role)
    ) {
      return true;
    }

    // Sans attendre : la trace ne doit ni retarder ni changer la réponse.
    void this.denials.record({
      event: "access.denied",
      actorId: request.user?.id ?? null,
      actorType: request.scopes != null ? "api_key" : "user",
      origin: requestOrigin(request),
      properties: { area: "admin" },
    });

    // Exception explicite plutôt que `false` : un garde qui renvoie `false`
    // produit un 403, qui confirme que la route existe. Le 404 ne dit rien.
    throw new NotFoundException();
  }
}

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role);
}
