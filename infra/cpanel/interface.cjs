"use strict";

/**
 * Démarrage de l'interface (Next) sous Passenger, dans l'archive autonome.
 *
 * L'interface y est en mode standalone (`output: "standalone"`) : le serveur
 * et les seuls fichiers de node_modules qu'il charge. Son `server.js` ouvre
 * lui-même son port ; on le remplace par un serveur à nous, pour réécrire
 * les en-têtes comme nginx (entetes.cjs) et désigner ce serveur-là à
 * Passenger. La configuration de Next est celle figée à la construction
 * (`required-server-files.json`), exactement comme la lit `server.js`.
 */

const http = require("node:http");
const path = require("node:path");
const { chargerReglages, emplacements } = require("./emplacements.cjs");
const { normaliserEntetes } = require("./entetes.cjs");

const { application, racine } = emplacements();
const dossier = path.join(application, "web", "apps", "web");

chargerReglages(racine, "web.env");
process.env.NODE_ENV = "production";
// Ici, rien ne se place devant Next pour envoyer à l'API les appels de Wings
// et de la facturation : c'est lui qui les relaie (src/server/api-relay.ts).
process.env.API_RELAY ??= "1";

const { config } = require(path.join(dossier, ".next-autonome", "required-server-files.json"));
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
process.chdir(dossier);

const next = require(path.join(dossier, "node_modules", "next"));
const app = next({ dev: false, dir: dossier, conf: config });
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
    // Hors de Passenger (répétition d'une nouvelle version, essai local), un
    // port ordinaire.
    serveur.listen(passenger ? "passenger" : Number.parseInt(process.env.PORT ?? "3000", 10));
  },
  (erreur) => {
    console.error(erreur);
    process.exit(1);
  },
);
