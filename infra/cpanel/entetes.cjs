"use strict";

/**
 * Ce que nginx fait en production (`infra/prod/panel.conf`) à l'entrée de
 * l'interface, refait ici pour un hébergement cPanel, où nginx n'est pas à
 * nous.
 *
 * Devant Next, il y a Apache puis Passenger. Passenger **ajoute** l'adresse
 * du visiteur à `X-Forwarded-For` sans effacer ce que le visiteur y a écrit,
 * et recopie tel quel `X-Forwarded-Host` : les croire, c'est laisser n'importe
 * qui choisir son adresse (et vider la limitation par adresse de son sens),
 * ou le domaine des liens envoyés par courrier.
 *
 * Passenger transmet aussi ce qu'il a vu, dans des en-têtes qu'un visiteur ne
 * peut pas écrire : Passenger refuse une requête qui arrive avec un en-tête
 * au préfixe `!~` hors du bloc que pose le serveur web. C'est d'eux que se
 * déduit tout le reste.
 *
 * @param {Record<string, string | string[] | undefined>} entetes en-têtes de
 *   la requête entrante, modifiés sur place.
 */
function normaliserEntetes(entetes) {
  const client = entetes["!~passenger-client-address"];
  const proto = entetes["!~passenger-proto"];

  // L'adresse vue par Passenger, et elle seule : `$remote_addr` de nginx.
  if (typeof client === "string" && client !== "") entetes["x-forwarded-for"] = client;
  else delete entetes["x-forwarded-for"];

  entetes["x-forwarded-proto"] = proto === "https" ? "https" : "http";

  // Réécrit, jamais relayé : le rendu en tire le domaine des liens de
  // réinitialisation.
  if (typeof entetes.host === "string") entetes["x-forwarded-host"] = entetes.host;
  else delete entetes["x-forwarded-host"];

  // Aucun frontal Cloudflare ici : un pays annoncé l'a été par le visiteur.
  delete entetes["cf-ipcountry"];

  // Les en-têtes internes de Passenger ont servi : ils ne vont pas plus loin.
  for (const nom of Object.keys(entetes)) {
    if (nom.startsWith("!~")) delete entetes[nom];
  }
}

module.exports = { normaliserEntetes };
