import { authCookieAttributes, sessionCookieName } from "@gamedashboard/contracts";
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { ApiKeyRepository } from "./api-key.repository";
import { SessionRepository, type SessionUser } from "./session.repository";

/**
 * Nom du cookie de session. Opaque : il ne porte aucune information.
 *
 * `__Host-` dès que le panel exige HTTPS — en production, ou servi sur une
 * origine `https://` (règle commune de `contracts`, que l'interface applique
 * aussi dans `apps/web/src/lib/session-cookie.ts`).
 *
 * **Une fonction, relue à chaque appel**, et non une constante : `.env` est
 * chargé par `ConfigModule` après l'évaluation des modules. Une constante y
 * aurait lu une origine absente et nommé le cookie `gd_session`, pendant que
 * l'interface, qui charge son environnement avant tout, cherchait
 * `__Host-gd_session`.
 */
export function sessionCookie(): string {
  return sessionCookieName(process.env);
}

/** Attributs des cookies d'authentification, à la pose comme à l'effacement. */
export function authCookieOptions(): ReturnType<typeof authCookieAttributes> {
  return authCookieAttributes(process.env);
}

/**
 * Requête authentifiée.
 *
 * `scopes` vaut `null` pour une session ouverte dans un navigateur — la
 * personne agit en son nom propre, sans restriction. Une valeur non nulle
 * signale une clé d'API, dont les portées **bornent** les droits de son
 * propriétaire.
 *
 * La distinction est portée par le type plutôt que par une liste vide : « pas
 * de restriction » et « aucune portée accordée » sont deux choses opposées, et
 * les représenter pareil donnerait à une clé sans portée les pleins pouvoirs.
 */
export interface AuthenticatedRequest {
  user: SessionUser;
  scopes: string[] | null;
  sessionToken?: string;
}

/**
 * Authentification des routes client, par session ou par clé d'API.
 *
 * Distinct de `NodeTokenGuard` (§7.5) et sans recouvrement : les routes
 * `/api/remote/*` ne doivent jamais passer par ici, sous peine de répondre au
 * daemon par une redirection vers la page de connexion, qu'il interprète comme
 * une panne du panel.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(ApiKeyRepository) private readonly keys: ApiKeyRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      cookies?: Record<string, string | undefined>;
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      user?: SessionUser;
      scopes?: string[] | null;
      sessionToken?: string;
    }>();

    const token = request.cookies?.[sessionCookie()];
    if (token) {
      const user = await this.sessions.resolve(token);
      if (!user) return false;

      // L'utilisateur authentifié est attaché à la requête. Aucun contrôleur ne
      // doit lire un identifiant d'utilisateur ailleurs : sinon il suffirait
      // d'en passer un autre dans l'URL pour voir les serveurs d'autrui.
      request.user = user;
      request.scopes = null;
      request.sessionToken = token;
      return true;
    }

    const bearer = readBearer(request.headers?.authorization);
    if (!bearer) return false;

    const principal = await this.keys.resolve(bearer, request.ip);
    if (!principal) return false;

    request.user = principal.user;
    request.scopes = principal.scopes;
    return true;
  }
}

/**
 * Extrait le jeton d'un en-tête `Authorization`.
 *
 * Le cookie est examiné en premier dans `canActivate` : une page du panel
 * envoie les deux si l'utilisateur a par ailleurs une clé configurée dans son
 * navigateur, et c'est alors la session qui doit l'emporter — sinon une clé
 * restreinte limiterait silencieusement ce que l'écran laisse faire.
 */
function readBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}
