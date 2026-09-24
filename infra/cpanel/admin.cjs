"use strict";

/**
 * Crée un administrateur avec la version en service :
 *
 *   node ~/gamedashboard/passenger/admin.cjs <email> <prénom> <nom>
 *
 * C'est la seule commande d'une installation sur cPanel (Terminal de
 * cPanel, une fois). Le mot de passe provisoire s'affiche, valable
 * vingt-quatre heures. Comme pour les migrations, seule la connexion à la
 * base est transmise, jamais la clé de chiffrement.
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { chargerReglages, emplacements } = require("./emplacements.cjs");

const { application, racine } = emplacements();
chargerReglages(racine, "api.env");

const resultat = spawnSync(
  process.execPath,
  [path.join(application, "api", "creer-admin.mjs"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: process.env.DATABASE_URL,
      ...(process.env.DATABASE_SSL ? { DATABASE_SSL: process.env.DATABASE_SSL } : {}),
    },
  },
);
process.exit(resultat.status ?? 1);
