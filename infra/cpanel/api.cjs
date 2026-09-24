"use strict";

/**
 * Démarrage de l'API (NestJS) sous Passenger, l'« application Node.js » de
 * cPanel. Chargé par `<racine>/passenger/api/app.cjs`.
 *
 * L'API tourne en TypeScript par tsx, comme sous systemd
 * (`infra/prod/gamedashboard-api.service`) : ce fichier installe tsx dans
 * le processus puis charge `src/main.ts`. Passenger prend le serveur qu'ouvre
 * `app.listen()` ; le port et l'adresse demandés n'y comptent plus.
 */

const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { chargerReglages, emplacements } = require("./emplacements.cjs");

const { application, racine } = emplacements();
const dossier = path.join(application, "apps", "api");

chargerReglages(racine, "api.env");
process.env.NODE_ENV ??= "production";
// tsx lit le tsconfig du dossier courant : celui de l'API.
process.chdir(dossier);

createRequire(path.join(dossier, "package.json"))("tsx/esm/api").register();

import(pathToFileURL(path.join(dossier, "src", "main.ts")).href).catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
