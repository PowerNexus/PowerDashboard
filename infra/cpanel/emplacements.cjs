"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Où tout se trouve, sur un hébergement cPanel (`docs/hebergement-cpanel.md`) :
 *
 *   <racine>/versions/<id>/          une version extraite ; ce fichier y vit
 *   <racine>/actuelle                lien vers la version active
 *   <racine>/env/api.env, web.env    les réglages, secrets compris (0600)
 *   <racine>/passenger/api/          racine d'application Passenger de l'API
 *   <racine>/passenger/interface/    celle de l'interface
 *
 * Les racines d'application ne contiennent qu'un `app.cjs` d'une ligne, qui
 * charge celui de la version active. Deux raisons : CloudLinux pose son
 * propre lien `node_modules` dans la racine d'application et refuse d'en
 * trouver un autre — or pnpm en pose un dans chaque paquet ; et une racine
 * fixe laisse changer de version en déplaçant un lien, sans toucher aux
 * réglages de cPanel.
 *
 * Node suit les liens : `__dirname` est ici le vrai dossier de la version,
 * jamais `actuelle`. `GAMEDASHBOARD_RACINE` ne sert qu'à l'essayer ailleurs.
 */
function emplacements() {
  const application = path.resolve(__dirname, "..", "..");
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: lu au démarrage sous Passenger, par aucune tâche turbo
  const racine = process.env.GAMEDASHBOARD_RACINE || path.resolve(application, "..", "..");
  return { application, racine };
}

/**
 * Charge `<racine>/env/<nom>`.
 *
 * Une variable déjà posée dans l'environnement garde sa valeur : c'est la
 * règle de Node, et c'est ce qui laisse l'écran de cPanel en surcharger une.
 * Le fichier reste la référence — cPanel garde ses variables en clair dans
 * ses propres réglages, un secret n'a pas à y figurer.
 */
function chargerReglages(racine, nom) {
  const fichier = path.join(racine, "env", nom);
  if (!fs.existsSync(fichier)) {
    throw new Error(`Réglages introuvables : ${fichier} (docs/hebergement-cpanel.md, étape 3)`);
  }
  process.loadEnvFile(fichier);
}

module.exports = { chargerReglages, emplacements };
