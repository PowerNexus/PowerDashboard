/*
 * Agent de service du panel.
 *
 * **Ce qu'il ne fait surtout pas : mettre des pages en cache.** Le panel est
 * authentifié de bout en bout ; garder une page rendue reviendrait à la
 * ressortir à la personne suivante sur la même machine, ou à la même personne
 * après sa déconnexion. Les réponses de l'API sont écartées pour la même
 * raison, et parce qu'un état de serveur d'il y a dix minutes est pire
 * qu'absent : il est faux sans le dire.
 *
 * Ce qu'il fait, et qui suffit à rendre l'application installable et utile
 * hors ligne :
 *
 * - il sert les ressources **immuables** de Next (`/_next/static/…`, dont le
 *   nom contient déjà une empreinte) depuis le cache ;
 * - il répond une page « hors ligne » quand une navigation échoue, au lieu de
 *   l'écran d'erreur du navigateur.
 */

// Change à chaque version du fichier : l'activation efface tout ce qui ne
// porte pas ce nom, ce qui évite qu'un ancien lot survive indéfiniment.
const CACHE = "gd-v1";
const HORS_LIGNE = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(HORS_LIGNE))
      // Une page hors ligne qu'on n'a pas pu chercher ne doit pas empêcher
      // l'installation : le reste de l'agent rend service sans elle.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  // Un autre domaine — le logo d'un revendeur, un node Wings — ne nous
  // regarde pas : on laisse le navigateur faire.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(depuisLeCache(requete));
    return;
  }

  if (requete.mode === "navigate") {
    event.respondWith(
      fetch(requete).catch(() =>
        caches.match(HORS_LIGNE).then(
          (reponse) =>
            reponse ??
            new Response("Hors ligne.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            }),
        ),
      ),
    );
  }

  // Tout le reste — `/api/…`, les images de marque, les polices distantes —
  // part au réseau sans que l'agent s'en mêle.
});

/** Cache d'abord : ces fichiers portent une empreinte, ils ne changent jamais. */
async function depuisLeCache(requete) {
  const connu = await caches.match(requete);
  if (connu) return connu;

  const reponse = await fetch(requete);
  // Seules les réponses complètes sont gardées : une 206 ou une erreur mise
  // en cache se reservirait telle quelle jusqu'à la prochaine version.
  if (reponse.ok && reponse.status === 200) {
    const cache = await caches.open(CACHE);
    cache.put(requete, reponse.clone());
  }
  return reponse;
}
