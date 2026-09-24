/**
 * En-têtes posés sur **chaque** réponse de l'API (ASVS 14.4.4, 8.2.1).
 *
 * Next pose les siens (`next.config.ts`) sur ce que voit le navigateur ; l'API,
 * elle, ne posait rien. Elle n'est jointe que par Next, mais pas seulement :
 * nginx publie l'API applicative, le statut et la spécification, et un proxy
 * mal réglé devant la machine en publierait davantage. Ce qui la protège ne
 * doit pas dépendre de qui l'appelle.
 *
 * - `X-Content-Type-Options: nosniff` : un corps se lit selon son type déclaré,
 *   jamais selon ce qu'il contient. Un nom de serveur ou un fichier renvoyé
 *   tel quel ne devient pas du HTML exécutable parce qu'il en a l'air.
 * - `Cache-Control: no-store` par défaut : presque tout ce que l'API rend
 *   dépend de qui demande (sessions, serveurs, clés). Aucun cache, ni d'un
 *   intermédiaire ni du navigateur, n'a à le garder. Une route qui **veut** être
 *   gardée le dit elle-même (`@Header("cache-control", …)` : statut public,
 *   spécification OpenAPI) et ce choix explicite l'emporte.
 */

/** Ce que le crochet emploie d'une réponse Fastify. */
interface ReplyHeaders {
  hasHeader(name: string): boolean;
  header(name: string, value: string): unknown;
}

/** Ce que l'inscription emploie de l'instance Fastify. */
interface HookTarget {
  addHook(
    name: "onSend",
    hook: (request: unknown, reply: ReplyHeaders, payload: unknown) => Promise<unknown>,
  ): unknown;
}

/**
 * Inscrit le crochet `onSend` sur l'instance Fastify de l'API.
 *
 * `onSend` et non `onRequest` : c'est le seul moment où l'on sait si la route a
 * posé son propre `Cache-Control`, et il passe aussi sur les refus (403, 404,
 * Problem Details), qui disent parfois plus qu'on ne voudrait voir en cache.
 */
export function registerResponseHeaders(instance: HookTarget): void {
  instance.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });
}
