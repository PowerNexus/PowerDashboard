"use strict";

/**
 * Choisit la version à démarrer, pour l'API comme pour l'interface.
 *
 * Passenger charge `<racine>/passenger/<rôle>/app.cjs`, qui ne fait
 * qu'appeler ce lanceur. Les racines d'application restent ainsi fixes :
 * changer de version, c'est changer une ligne de `etat.json`, puis relancer.
 * Aucun lien symbolique, que le gestionnaire de fichiers de cPanel ne sait
 * pas créer — la première installation se fait sans terminal.
 *
 * C'est aussi le dernier filet quand une mise à jour tourne mal : la
 * nouvelle version doit confirmer son démarrage (UpdateService). Si l'API
 * redémarre plus de trois fois sans l'avoir fait, ou si la version ne se
 * charge même pas, le lanceur revient de lui-même à la précédente et met la
 * fautive de côté.
 *
 * Ce fichier est recopié ici depuis chaque version confirmée
 * (`versions/<v>/demarrage/lanceur.cjs`) : il ne dépend que de Node.
 */

const fs = require("node:fs");
const path = require("node:path");

const DEMARRAGES_SANS_CONFIRMATION = 3;

/**
 * Le module d'une commande de la version en service (`admin`), sans garde :
 * une commande qui échoue n'a rien à dire de la version.
 */
function commande(nom, racine = path.resolve(__dirname, "..")) {
  const etat = lireEtat(racine);
  const version = versionDemarrable(racine, etat.enService) ? etat.enService : plusRecente(racine);
  if (!version) throw new Error(`Aucune version installée dans ${path.join(racine, "versions")}`);
  return fichierDeDemarrage(racine, version, nom);
}

function lancer(role, racine = path.resolve(__dirname, "..")) {
  const etat = lireEtat(racine);
  let version = versionDemarrable(racine, etat.enService) ? etat.enService : plusRecente(racine);
  if (!version) {
    throw new Error(`Aucune version installée dans ${path.join(racine, "versions")}`);
  }

  const bascule = etat.bascule;
  if (role === "api" && bascule && !bascule.confirmee && bascule.version === version) {
    bascule.demarrages = (bascule.demarrages ?? 0) + 1;
    if (bascule.demarrages > DEMARRAGES_SANS_CONFIRMATION && revenir(racine, etat, version)) {
      version = etat.enService;
    }
    ecrireEtat(racine, etat);
  }

  try {
    require(fichierDeDemarrage(racine, version, role));
  } catch (erreur) {
    // Une version qui ne se charge même pas : revenir, si l'on peut.
    if (!revenir(racine, etat, version, `Chargement impossible : ${erreur.message}`)) throw erreur;
    ecrireEtat(racine, etat);
    console.error(erreur);
    require(fichierDeDemarrage(racine, etat.enService, role));
  }
}

/** Revient à la version précédente, met la fautive de côté. Faux s'il n'y en a pas. */
function revenir(racine, etat, fautive, message = "La version n'a pas confirmé son démarrage.") {
  const precedente = etat.precedente;
  if (!precedente || precedente === fautive || !versionDemarrable(racine, precedente)) {
    return false;
  }
  etat.enService = precedente;
  etat.precedente = null;
  etat.bascule = null;
  etat.refusees = [...new Set([...(etat.refusees ?? []), fautive])];
  etat.dernierResultat = {
    etat: "refusee",
    version: fautive,
    message,
    date: new Date().toISOString(),
  };
  // L'autre application doit suivre : Passenger la relancera à sa prochaine
  // requête.
  for (const role of ["api", "interface"]) {
    const dossier = path.join(racine, "passenger", role, "tmp");
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, "restart.txt"), `${Date.now()}\n`);
  }
  return true;
}

function fichierDeDemarrage(racine, version, role) {
  return path.join(racine, "versions", version, "demarrage", `${role}.cjs`);
}

function versionDemarrable(racine, version) {
  return (
    typeof version === "string" &&
    /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) &&
    fs.existsSync(fichierDeDemarrage(racine, version, "api"))
  );
}

/** La plus haute version installée : celle d'une première installation. */
function plusRecente(racine) {
  let noms = [];
  try {
    noms = fs.readdirSync(path.join(racine, "versions"));
  } catch {
    return null;
  }
  return (
    noms
      .filter((nom) => versionDemarrable(racine, nom))
      .sort(comparerVersions)
      .at(-1) ?? null
  );
}

/** Ordre des versions sémantiques ; une préversion passe avant sa version. */
function comparerVersions(a, b) {
  const decouper = (v) => {
    const [base, pre] = v.slice(1).split("-", 2);
    return { nombres: base.split(".").map(Number), pre: pre ?? null };
  };
  const x = decouper(a);
  const y = decouper(b);
  for (let i = 0; i < 3; i++) {
    if (x.nombres[i] !== y.nombres[i]) return x.nombres[i] - y.nombres[i];
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

function lireEtat(racine) {
  try {
    return JSON.parse(fs.readFileSync(path.join(racine, "etat.json"), "utf8"));
  } catch {
    return {};
  }
}

/** Écriture atomique : un fichier à moitié écrit ne se lit jamais. */
function ecrireEtat(racine, etat) {
  const fichier = path.join(racine, "etat.json");
  const provisoire = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(provisoire, `${JSON.stringify(etat, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(provisoire, fichier);
}

module.exports = { commande, comparerVersions, lancer, plusRecente };
