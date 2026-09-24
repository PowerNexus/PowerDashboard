import { impersonationReturnCookieName } from "@gamedashboard/contracts";

/**
 * Constantes partagées par les deux bouts de la prise en main.
 *
 * Le départ vit dans le contrôleur d'administration — c'est un geste d'agent —
 * et le retour dans celui d'authentification, parce qu'à ce moment-là la
 * session est celle du client et n'a plus accès à l'administration. Les deux
 * doivent s'accorder sur le nom du cookie et la durée, d'où ce fichier plutôt
 * qu'une valeur recopiée de chaque côté.
 */

/**
 * Cookie où dort le jeton de l'agent pendant la prise en main.
 *
 * Distinct du cookie de session, et c'est tout l'intérêt : l'agent garde sa
 * propre session ouverte pendant qu'il regarde ailleurs, et rentre chez lui
 * d'un clic. Sans cela, chaque diagnostic coûterait une reconnexion complète —
 * et l'on finirait par ne plus s'en servir.
 *
 * `__Host-` sous la même condition que la session, puisqu'il en porte une :
 * sans le préfixe, un sous-domaine pouvait poser un `gd_return` du même nom
 * et choisir la session rouverte au retour. Relu à chaque appel, pour la même
 * raison que `sessionCookie()` : `.env` arrive après l'évaluation des modules.
 */
export function impersonationReturnCookie(): string {
  return impersonationReturnCookieName(process.env);
}

/**
 * Trente minutes.
 *
 * Une prise en main est un geste de diagnostic, pas un accès. Douze heures —
 * la durée maximale d'une session ordinaire — en feraient une porte ouverte
 * chez un client, oubliée sur un poste jusqu'au lendemain.
 *
 * La session de l'agent, mise de côté, dort pendant ce temps : son
 * inactivité court (trente minutes, comme toute session). Une visite qui
 * touche à sa fin le renvoie donc à l'écran de connexion au retour, et c'est
 * la règle : personne ne s'est servi de cette session depuis une demi-heure.
 */
export const IMPERSONATION_TTL_MS = 30 * 60_000;
