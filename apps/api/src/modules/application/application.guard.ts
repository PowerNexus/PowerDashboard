import { type ApplicationScope, hasApplicationScope } from "@gamedashboard/contracts";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApplicationKeyRepository, type ApplicationPrincipal } from "./application-key.repository";

/** Requête de l'API applicative, une fois la clé reconnue. */
export interface ApplicationRequest {
  application: ApplicationPrincipal;
  ip?: string;
}

const SCOPES_KEY = "application:scopes";

/**
 * Portées exigées par une route.
 *
 * Déclarées au-dessus de chaque route plutôt que vérifiées dans son corps :
 * une vérification dans le corps s'oublie, et rien ne le signale — la route
 * répond simplement à tout le monde. Déclarée ici, son absence se voit à la
 * lecture, juste à côté du verbe HTTP.
 */
export const RequireScopes = (...scopes: ApplicationScope[]) => SetMetadata(SCOPES_KEY, scopes);

const PLATFORM_KEY = "application:platform-only";

/**
 * Route réservée aux clés **de la plateforme**.
 *
 * Une clé peut être bornée à un revendeur. Certaines routes n'ont alors aucun
 * sens, et deux d'entre elles seraient dangereuses : poser sa propre enveloppe
 * de revente revient à ne plus en avoir, et lire la configuration d'un node
 * revient à repartir avec le jeton de son daemon, c'est-à-dire avec la machine.
 *
 * Déclarée au-dessus de la route pour la même raison que les portées : une
 * vérification écrite dans le corps s'oublie, et son absence ne se voit pas.
 * L'argument sert au message de refus — « les enveloppes de revente relèvent
 * de la plateforme » se comprend sans ouvrir la documentation.
 */
export const PlatformOnly = (quoi: string) => SetMetadata(PLATFORM_KEY, quoi);

/**
 * Authentification de l'API applicative.
 *
 * **Jamais de cookie.** Une clé, et rien d'autre. Accepter la session du
 * navigateur ici ferait de n'importe quelle page visitée par un administrateur
 * connecté un déclencheur possible de provisionnement : le navigateur joint
 * ses cookies tout seul, une clé non. C'est la différence entre une API que
 * l'on appelle et une API que l'on subit.
 */
@Injectable()
export class ApplicationGuard implements CanActivate {
  constructor(
    @Inject(ApplicationKeyRepository) private readonly keys: ApplicationKeyRepository,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      application?: ApplicationPrincipal;
    }>();

    const bearer = readBearer(request.headers?.authorization);
    // 401 explicite plutôt qu'un `false` : un système tiers doit pouvoir
    // distinguer « ma clé est refusée » de « cette route n'existe pas », sans
    // quoi la mise en service se fait à l'aveugle.
    if (!bearer) throw new UnauthorizedException("Clé applicative manquante.");

    const principal = await this.keys.resolve(bearer, request.ip);
    if (!principal) throw new UnauthorizedException("Clé applicative refusée.");

    request.application = principal;

    /*
     * Le périmètre avant les portées.
     *
     * Une clé de revendeur peut parfaitement détenir `resellers.write` — rien
     * ne l'empêche, les portées et le périmètre sont deux axes distincts. C'est
     * la route qui décide qu'elle relève de la plateforme, et ce refus-là
     * passe avant le contrôle des portées : répondre « il vous manque une
     * portée » à quelqu'un qui l'a déjà l'enverrait demander une clé plus
     * large, qui ne changerait rien.
     */
    const platformOnly = this.reflector.getAllAndOverride<string | undefined>(PLATFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (platformOnly !== undefined && principal.resellerId !== null) {
      throw new ForbiddenException(
        `Cette clé est bornée à un revendeur : ${platformOnly} relève de la plateforme.`,
      );
    }

    /**
     * Une route **sans déclaration** est refusée ; une route déclarée sans
     * portée est ouverte à toute clé valide.
     *
     * La distinction est celle de l'oubli et de la décision, et elle tient à
     * ce que `undefined` n'est pas `[]`. Oublier `@RequireScopes` rend la route
     * inutilisable — ce qui se remarque au premier appel. Le défaut inverse
     * l'ouvrirait à toute clé, ce qui ne se remarque jamais.
     *
     * `@RequireScopes()` sans argument est donc un choix écrit noir sur blanc,
     * et il ne sert qu'à `/identity`, qui ne lit rien.
     */
    const required = this.reflector.getAllAndOverride<ApplicationScope[] | undefined>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) {
      throw new ForbiddenException("Cette route ne déclare aucune portée.");
    }

    const missing = required.filter((scope) => !hasApplicationScope(principal.scopes, scope));
    if (missing.length > 0) {
      // La portée manquante est nommée : l'appelant ne peut pas la deviner, et
      // la connaître ne lui apprend rien qu'il ne puisse lire dans la doc.
      throw new ForbiddenException(`Portée manquante : ${missing.join(", ")}.`);
    }

    return true;
  }
}

function readBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}
