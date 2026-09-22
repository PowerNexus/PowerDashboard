import { check, sleep } from "k6";
import http from "k6/http";

/**
 * L'émission des jetons de console, sous la charge d'un incident.
 *
 * **Ce n'est pas le flux de console qui est chargé ici**, et c'est le point :
 * le panel n'en relaie aucun octet. Le navigateur parle directement au daemon,
 * et le panel ne fait qu'émettre un jeton signé de dix minutes. C'est donc
 * cette émission qu'il faut mesurer — et elle a un coût réel : une lecture des
 * permissions, une signature, une écriture au journal.
 *
 * Le profil imite ce qui arrive vraiment : un node tombe, et tout le monde
 * ouvre sa console en même temps. Puis chacun la garde ouverte, et redemande
 * un jeton toutes les dix minutes — ici raccourci pour tenir dans l'essai.
 *
 *   k6 run infra/load/console.js -e BASE=https://panel.example -e TOKEN=gd_live_…
 *
 * Le jeton est une **clé personnelle d'essai**, créée pour l'occasion et
 * révoquée après. Passer un mot de passe ferait ouvrir une session par
 * utilisateur virtuel, ce qui mesurerait l'authentification et laisserait des
 * milliers de lignes derrière.
 */
const BASE = __ENV.BASE || "http://127.0.0.1:3000";
const TOKEN = __ENV.TOKEN;
const SERVEUR = __ENV.SERVER;

export const options = {
  stages: [
    // La ruée : de zéro à deux cents en dix secondes, comme un incident.
    { duration: "10s", target: 200 },
    { duration: "1m", target: 200 },
    { duration: "20s", target: 0 },
  ],
  thresholds: {
    // Plus tolérant que la lecture : une signature coûte, et l'utilisateur
    // attend déjà que sa console s'ouvre.
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.02"],
  },
};

export function setup() {
  if (!TOKEN || !SERVEUR) {
    throw new Error(
      "TOKEN et SERVER sont requis : k6 run console.js -e TOKEN=gd_live_… -e SERVER=<identifiant>",
    );
  }
}

export default function () {
  const reponse = http.post(`${BASE}/api/v1/client/servers/${SERVEUR}/websocket`, null, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    tags: { route: "jeton-console" },
  });

  check(reponse, {
    "jeton : 2xx": (r) => r.status >= 200 && r.status < 300,
    // Le jeton **et** l'adresse : l'un sans l'autre n'ouvre rien, et une
    // réponse amputée passerait pour un succès.
    "jeton : porte le jeton et la socket": (r) =>
      String(r.body).includes("token") && String(r.body).includes("socket"),
  });

  // Dix secondes plutôt que dix minutes : le renouvellement réel est trop
  // lent pour tenir dans un essai, et ce qu'on veut mesurer est le coût d'une
  // émission, pas l'attente entre deux.
  sleep(10);
}
