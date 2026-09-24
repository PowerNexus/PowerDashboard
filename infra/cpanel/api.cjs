"use strict";

/**
 * Démarrage de l'API sous Passenger, dans l'archive autonome.
 *
 * L'API y est compilée en un seul fichier (`api/main.cjs`, esbuild) : ni
 * tsx, ni node_modules à installer, hormis le module natif d'argon2 livré à
 * côté. Passenger prend le serveur qu'ouvre `app.listen()` ; le port et
 * l'adresse demandés n'y comptent plus.
 *
 * `GAMEDASHBOARD_RACINE` et `GAMEDASHBOARD_VERSION` disent à l'API qu'elle
 * tourne en mode autonome, et laquelle elle est : c'est ce qui allume sa
 * mise à jour automatique (src/modules/updates).
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { chargerReglages, emplacements, lireRelease } = require("./emplacements.cjs");

const { application, racine } = emplacements();

chargerReglages(racine, "api.env");
process.env.NODE_ENV ??= "production";
process.env.GAMEDASHBOARD_RACINE = racine;
const release = lireRelease(application);
process.env.GAMEDASHBOARD_VERSION = release.version;
// Le dépôt dont les releases suivantes seront tirées : celui qui a publié
// cette version.
process.env.GAMEDASHBOARD_DEPOT ??= release.depot;

/*
 * Les migrations de cette version, avant tout : c'est ainsi qu'une première
 * installation se fait sans terminal, et qu'une nouvelle version les joue
 * dès sa répétition, avant la moindre bascule. Rien n'est rejoué quand la
 * base est à jour.
 *
 * Seule la connexion à la base est transmise au migrateur, jamais la clé de
 * chiffrement. Une migration qui échoue arrête le démarrage : une API sur un
 * schéma à moitié migré ferait pire que pas d'API.
 */
const migration = spawnSync(
  process.execPath,
  [path.join(application, "api", "migrer.cjs"), path.join(application, "api", "migrations")],
  {
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: process.env.DATABASE_URL,
      ...(process.env.DATABASE_SSL ? { DATABASE_SSL: process.env.DATABASE_SSL } : {}),
    },
  },
);
if (migration.status !== 0) {
  throw new Error(`Migrations de ${process.env.GAMEDASHBOARD_VERSION} en échec`);
}

process.chdir(path.join(application, "api"));
require(path.join(application, "api", "main.cjs"));
