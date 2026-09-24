/**
 * D'où vient une requête, pour le journal des refus.
 *
 * La route est son **gabarit** (`GET /api/v1/client/servers/:id/files`), pas
 * l'adresse demandée : une chaîne de requête peut porter un jeton, et un
 * refus consigné ne doit jamais emporter de secret. Le gabarit suffit à dire
 * ce qui était visé ; l'objet précis — serveur, permission — est noté à part
 * par l'appelant.
 */
export interface RequestOrigin {
  /** Adresse du client, telle que Fastify la lit derrière le proxy de confiance. */
  ip: string | null;
  route: string;
}

/** Ce que les requêtes Fastify portent, et que les doublures de test peuvent omettre. */
interface OriginSource {
  ip?: string;
  method?: string;
  url?: string;
  routeOptions?: { url?: string };
}

/** Borne de la route consignée : un gabarit n'approche pas cette longueur. */
const MAX_ROUTE = 200;

/**
 * `unknown` en entrée : les types de requête des contrôleurs ne déclarent que
 * ce qu'ils lisent (`user`, `scopes`…), et la requête Fastify porte le reste.
 */
export function requestOrigin(raw: unknown): RequestOrigin {
  const request = raw as OriginSource | undefined;
  // Sans gabarit (requête hors routeur), le chemin seul, jamais sa requête.
  const pattern = request?.routeOptions?.url ?? request?.url?.split("?")[0] ?? "";
  return {
    ip: request?.ip ?? null,
    route: `${request?.method ?? "?"} ${pattern}`.trim().slice(0, MAX_ROUTE),
  };
}
