import { apiKeyPrefix } from "@gamedashboard/auth";
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
import { type RequestOrigin, requestOrigin } from "../../common/request-origin";
import { DenialLogService } from "../activity/denial-log.service";
import { ApplicationKeyRepository, type ApplicationPrincipal } from "./application-key.repository";

/**
 * Forme d'un préfixe de clé émis par le panel (`generateApiKey`).
 *
 * Seul un préfixe de cette forme est consigné : une clé mal collée pourrait
 * sinon faire entrer un morceau de secret dans le journal.
 */
const KEY_PREFIX_SHAPE = /^gd_[a-z]+_[0-9a-f]{12}$/;

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
    @Inject(DenialLogService) private readonly denials: DenialLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      method?: string;
      url?: string;
      routeOptions?: { url?: string };
      application?: ApplicationPrincipal;
    }>();

    const bearer = readBearer(request.headers?.authorization);
    // 401 explicite plutôt qu'un `false` : un système tiers doit pouvoir
    // distinguer « ma clé est refusée » de « cette route n'existe pas », sans
    // quoi la mise en service se fait à l'aveugle.
    // Pas de trace ici : rien n'a été présenté, c'est le bruit d'Internet que
    // le journal d'accès de nginx tient déjà.
    if (!bearer) throw new UnauthorizedException("Clé applicative manquante.");

    const principal = await this.keys.resolve(bearer, request.ip);
    if (!principal) {
      /*
       * Consigné (NC-12) : une clé révoquée que la boutique présente encore,
       * ou une clé essayée au hasard, ne laissait aucune trace. Le préfixe
       * désigne la clé dans l'écran des clés ; le secret, lui, n'est jamais
       * écrit. Sans attendre : le refus coûte le même temps qu'avant.
       */
      const prefix = apiKeyPrefix(bearer);
      void this.denials.record({
        event: "application.key_rejected",
        actorId: null,
        actorType: "system",
        origin: requestOrigin(request),
        properties: { prefix: prefix && KEY_PREFIX_SHAPE.test(prefix) ? prefix : null },
      });
      throw new UnauthorizedException("Clé applicative refusée.");
    }

    request.application = principal;
    const origin = requestOrigin(request);

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
      this.denied(principal, origin, { platformOnly: true });
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
      this.denied(principal, origin, { undeclared: true });
      throw new ForbiddenException("Cette route ne déclare aucune portée.");
    }

    const missing = required.filter((scope) => !hasApplicationScope(principal.scopes, scope));
    if (missing.length > 0) {
      this.denied(principal, origin, { missing });
      // La portée manquante est nommée : l'appelant ne peut pas la deviner, et
      // la connaître ne lui apprend rien qu'il ne puisse lire dans la doc.
      throw new ForbiddenException(`Portée manquante : ${missing.join(", ")}.`);
    }

    return true;
  }

  /**
   * Une clé valide qui demande hors de son périmètre : refus d'accès,
   * consigné au nom de la clé comme ses autres gestes
   * (`application:<nom>`, sans compte).
   */
  private denied(
    principal: ApplicationPrincipal,
    origin: RequestOrigin,
    properties: Record<string, unknown>,
  ): void {
    void this.denials.record({
      event: "access.denied",
      actorId: null,
      actorType: "api_key",
      actorLabel: `application:${principal.name}`,
      origin,
      properties: { key: principal.keyId, ...properties },
    });
  }
}

function readBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}
