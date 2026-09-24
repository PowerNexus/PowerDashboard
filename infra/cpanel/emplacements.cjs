"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Où tout se trouve, sur un hébergement cPanel (`docs/hebergement-cpanel.md`).
 * L'archive autonome s'extrait telle quelle dans le dossier personnel :
 *
 *   <racine>/passenger/lanceur.cjs          choisit la version à démarrer
 *   <racine>/passenger/api/app.cjs          racine d'application de l'API
 *   <racine>/passenger/interface/app.cjs    celle de l'interface
 *   <racine>/versions/<vX.Y.Z>/             une version, prête à tourner
 *     RELEASE                               version, commit, dépôt
 *     demarrage/                            ces modules
 *     api/main.cjs, api/migrer.cjs          l'API compilée, son migrateur
 *     web/                                  l'interface (Next standalone)
 *   <racine>/env/api.env, env/web.env       les réglages, secrets compris
 *   <racine>/etat.json                      l'état des mises à jour
 *
 * Ce fichier vit dans `versions/<v>/demarrage/` : la version est le dossier
 * parent, la racine trois niveaux plus haut. `GAMEDASHBOARD_RACINE` ne sert
 * qu'à l'essayer ailleurs.
 */
function emplacements() {
  const application = path.resolve(__dirname, "..");
  const racine = process.env.GAMEDASHBOARD_RACINE || path.resolve(application, "..", "..");
  return { application, racine };
}

/**
 * Charge `<racine>/env/<nom>`.
 *
 * Une variable déjà posée dans l'environnement garde sa valeur : c'est la
 * règle de Node, et c'est ce qui laisse la répétition d'une nouvelle version
 * lui imposer son port. Le fichier reste la référence — cPanel garde les
 * variables de son écran en clair dans ses propres réglages, un secret n'a
 * pas à y figurer.
 */
function chargerReglages(racine, nom) {
  const fichier = path.join(racine, "env", nom);
  if (!fs.existsSync(fichier)) {
    throw new Error(`Réglages introuvables : ${fichier} (docs/hebergement-cpanel.md)`);
  }
  process.loadEnvFile(fichier);
}

/** Le fichier RELEASE d'une version, en objet (`version`, `commit`, `depot`…). */
function lireRelease(application) {
  const texte = fs.readFileSync(path.join(application, "RELEASE"), "utf8");
  return Object.fromEntries(
    texte
      .split("\n")
      .map((ligne) => ligne.match(/^([a-z_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, cle, valeur]) => [cle, valeur]),
  );
}

module.exports = { chargerReglages, emplacements, lireRelease };
