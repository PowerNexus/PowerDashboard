/**
 * Le catalogue des routes, tel que l'écran « API » le lit.
 *
 * Il ne vit plus ici : il a été remonté dans `@gamedashboard/contracts`, parce
 * que la spécification OpenAPI en découle aussi. Deux listes tenues à la main
 * finissent toujours par diverger, et le jour où elles divergent, personne ne
 * sait laquelle croire.
 *
 * Ce fichier reste comme point d'entrée de l'interface : les composants
 * l'importent déjà, et les faire tous pointer ailleurs n'apporterait rien.
 */
export {
  APPLICATION_ROUTES,
  type ApiRoute,
  CLIENT_ROUTES,
  type HttpMethod,
  REALTIME_EVENTS,
  type RealtimeEvent,
  SESSION_ROUTES,
} from "@gamedashboard/contracts";
