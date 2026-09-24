"use strict";

/**
 * Démarrage de l'interface (Next) sous Passenger, l'« application Node.js »
 * de cPanel. Chargé par `<racine>/passenger/interface/app.cjs`.
 *
 * Passenger lit ce fichier par `require` : il est en CommonJS. Il remplace
 * `next start`, qui est une commande et non un module qu'on puisse charger.
 */

const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const { chargerReglages, emplacements } = require("./emplacements.cjs");
const { normaliserEntetes } = require("./entetes.cjs");

const { application, racine } = emplacements();
const dossier = path.join(application, "apps", "web");

chargerReglages(racine, "web.env");
process.env.NODE_ENV ??= "production";
// Ici, rien ne se place devant Next pour envoyer à l'API les appels de Wings
// et de la facturation : c'est lui qui les relaie (src/server/api-relay.ts).
process.env.API_RELAY ??= "1";
process.chdir(dossier);

const next = createRequire(path.join(dossier, "package.json"))("next");
const app = next({ dev: false, dir: dossier });
const traiter = app.getRequestHandler();

/*
 * Passenger prend d'ordinaire le premier serveur qui écoute. On le lui
 * désigne plutôt : si Next ouvrait un jour un serveur interne avant le
 * nôtre, c'est lui qui recevrait les visiteurs.
 */
const passenger = typeof PhusionPassenger === "undefined" ? null : PhusionPassenger;
passenger?.configure({ autoInstall: false });

app.prepare().then(
  () => {
    const serveur = http.createServer((requete, reponse) => {
      normaliserEntetes(requete.headers);
      traiter(requete, reponse);
    });
    // Hors de Passenger (pour l'essayer en local), un port ordinaire.
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: lu au démarrage sous Passenger, par aucune tâche turbo
    serveur.listen(passenger ? "passenger" : Number.parseInt(process.env.PORT ?? "3000", 10));
  },
  (erreur) => {
    console.error(erreur);
    process.exit(1);
  },
);
