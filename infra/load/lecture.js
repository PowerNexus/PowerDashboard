import { check, sleep } from "k6";
import http from "k6/http";

/**
 * La charge de lecture : ce que toute ouverture de page demande.
 *
 * L'état, la marque et la liste des serveurs. Ces trois appels partent à
 * chaque affichage, et ce sont eux qui se dégradent en premier quand la base
 * peine — bien avant les écrans lourds, qu'on ouvre rarement.
 *
 * **Sans session.** Charger un parcours authentifié mesurerait surtout le coût
 * d'ouvrir des sessions, et laisserait des milliers de lignes en base. Les
 * trois routes visées sont publiques par construction.
 *
 *   k6 run infra/load/lecture.js -e BASE=https://panel.example
 */
const BASE = __ENV.BASE || "http://127.0.0.1:3000";

export const options = {
  /*
   * Une montée progressive, un palier, une descente.
   *
   * Le palier est ce qu'on mesure ; la montée existe pour que les caches et
   * les connexions s'établissent. Partir d'emblée à pleine charge mesurerait
   * un démarrage à froid, que personne ne subit en service.
   */
  stages: [
    { duration: "30s", target: 50 },
    { duration: "2m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    // Au-delà d'une demi-seconde au 95e centile, une page composée de trois
    // appels dépasse la seconde et se ressent.
    http_req_duration: ["p(95)<500"],
    // Une erreur sur cent est déjà visible en support.
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const etat = http.get(`${BASE}/api/v1/status`, { tags: { route: "status" } });
  check(etat, {
    "état : 200": (r) => r.status === 200,
    // Le corps est vérifié, pas seulement le code : une page d'erreur du
    // serveur web répond parfois 200, et l'essai passerait sans rien mesurer.
    "état : rend un rapport": (r) => String(r.body).includes("state"),
  });

  const marque = http.get(`${BASE}/brand/logo`, { redirects: 0, tags: { route: "marque" } });
  check(marque, { "marque : redirige": (r) => r.status === 307 || r.status === 200 });

  const manifeste = http.get(`${BASE}/manifest.webmanifest`, { tags: { route: "manifeste" } });
  check(manifeste, { "manifeste : 200": (r) => r.status === 200 });

  // Une seconde entre deux tours : un utilisateur ne recharge pas en boucle,
  // et sans pause on mesurerait la capacité à encaisser un déni de service
  // plutôt que la charge réelle.
  sleep(1);
}
