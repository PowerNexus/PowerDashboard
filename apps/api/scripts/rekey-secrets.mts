/**
 * Rechiffrement des secrets après changement du sel de dérivation.
 *
 * Le sel de `scrypt` n'est pas une étiquette : il décide de la clé dérivée. Le
 * changer rend illisible, d'un coup, tout ce qui a été chiffré avant — jetons
 * de daemon, mots de passe de bases, secrets TOTP et de webhooks. Il n'existe
 * pas de raccourci : il faut déchiffrer avec l'ancien sel puis rechiffrer avec
 * le nouveau, valeur par valeur.
 *
 *   pnpm --filter @gamedashboard/api exec tsx scripts/rekey-secrets.mts
 *
 * Deux propriétés dont dépend la sûreté de l'opération :
 *
 * 1. **Les deux sels sont écrits ici**, et le script n'importe pas
 *    `encryptSecret`. Il ne dépend donc pas de la version déployée de la
 *    bibliothèque : on le lance *avant* de mettre le nouveau code en ligne, et
 *    il n'y a jamais d'instant où le panel tourne avec un sel qui ne
 *    correspond pas à sa base.
 * 2. **Il est idempotent par construction.** Une valeur qui ne se déchiffre pas
 *    avec l'ancien sel est laissée telle quelle — GCM authentifie, donc une
 *    valeur déjà reprise échoue franchement au lieu de rendre des octets
 *    arbitraires. Le relancer sur une base déjà reprise ne fait rien.
 *
 * Tout passe dans **une transaction** : une reprise à moitié faite laisserait
 * une base dont une partie se lit et l'autre non, sans moyen de savoir
 * laquelle.
 *
 * Hors de portée, et volontairement : le jeton d'étape intermédiaire de
 * connexion (`login-challenge`), qui est chiffré lui aussi mais ne vit que
 * quelques minutes dans le navigateur. Au pire, une connexion en cours au
 * moment de la bascule est à recommencer.
 */
import { createClient } from "@gamedashboard/db";
import { sql } from "drizzle-orm";
import { ciphertextParts, createRekeyer } from "../src/common/rekey";

/**
 * D'où l'on vient, où l'on va.
 *
 * Deux reprises possibles avec le même script :
 * - **changement de sel** (l'incident d'origine) : `APP_SECRET_KEY` seule,
 *   `FROM_SALT` vaut par défaut l'ancien sel ;
 * - **rotation de la clé maître** (§5.4) : `APP_SECRET_KEY_OLD` porte la clé
 *   compromise, `APP_SECRET_KEY` la nouvelle, et le sel est le même des deux
 *   côtés (`FROM_SALT=gamedashboard.secrets.v2`).
 */
const FROM_SALT = process.env.FROM_SALT ?? "yorkhost.secrets.v1";
/** Sel de `packages/auth/src/secrets.ts`. Les deux doivent rester d'accord. */
const TO_SALT = "gamedashboard.secrets.v2";

const SECRET = process.env.APP_SECRET_KEY;
if (!SECRET) {
  console.error("APP_SECRET_KEY absente : impossible de relire quoi que ce soit.");
  process.exit(1);
}
/*
 * La clé d'arrivée passe le seuil de l'API (`MIN_SECRET_KEY_LENGTH`, redit
 * ici pour la raison donnée plus haut) : rechiffrer vers une clé que l'API
 * refusera au démarrage laisserait la base lisible par personne. La clé de
 * départ, elle, peut être courte : sortir d'une clé trop courte est justement
 * l'un des usages de ce script.
 */
if (SECRET.length < 32) {
  console.error(
    `APP_SECRET_KEY trop courte (${SECRET.length} caractères) : il en faut au moins 32. openssl rand -base64 48.`,
  );
  process.exit(1);
}
const OLD_SECRET = process.env.APP_SECRET_KEY_OLD ?? SECRET;
if (OLD_SECRET === SECRET && FROM_SALT === TO_SALT) {
  console.error("Rien à reprendre : même clé et même sel des deux côtés.");
  process.exit(1);
}

const rekeyer = createRekeyer({
  fromSecret: OLD_SECRET,
  fromSalt: FROM_SALT,
  toSecret: SECRET,
  toSalt: TO_SALT,
});

/**
 * Colonnes chiffrées à reprendre.
 *
 * `read`/`write` existent pour la seule table dont la colonne n'est pas du
 * texte : `settings.value` est du `jsonb`, et une chaîne y est stockée avec ses
 * guillemets. La lire brute donnerait `"iv:tag:données"` — trois parties, mais
 * la première commence par un guillemet, et le déchiffrement échouerait sans
 * qu'on sache pourquoi.
 */
const TARGETS: {
  table: string;
  key: string;
  column: string;
  where?: string;
  read?: string;
  write?: (value: string) => string;
}[] = [
  { table: "nodes", key: "id", column: "daemon_token_enc" },
  { table: "database_hosts", key: "id", column: "password_enc" },
  { table: "databases", key: "id", column: "password_enc" },
  { table: "user_credentials_totp", key: "id", column: "secret_enc" },
  { table: "webhooks", key: "id", column: "secret_enc" },
  { table: "application_webhooks", key: "id", column: "secret_enc" },
  {
    table: "settings",
    key: "key",
    column: "value",
    where: `"is_secret" = true`,
    read: `"value" #>> '{}'`,
    write: (value) => `to_jsonb(${literal(value)}::text)`,
  },
];

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const db = createClient();
let reprises = 0;
let ignorées = 0;

await db.transaction(async (tx) => {
  for (const target of TARGETS) {
    /*
     * Une table absente est signalée, pas fatale.
     *
     * Le catalogue ci-dessus vaut pour le schéma complet ; une base peut être
     * en retard d'une migration, ou une table avoir changé de nom. Sans ce
     * contrôle, la première table manquante annule la transaction — et la
     * reprise de toutes les autres avec elle, pour une raison qui n'a rien à
     * voir avec le chiffrement.
     */
    const [exists] = (await tx.execute(
      sql.raw(`select to_regclass('public.${target.table}') is not null as ok`),
    )) as unknown as { ok: boolean }[];
    if (!exists?.ok) {
      console.log(`  ${target.table} : absente de cette base, ignorée.`);
      continue;
    }

    const rows = (await tx.execute(
      sql.raw(
        `select "${target.key}" as k, ${target.read ?? `"${target.column}"`} as v` +
          ` from "${target.table}"` +
          (target.where ? ` where ${target.where}` : ""),
      ),
    )) as unknown as { k: string; v: unknown }[];

    for (const row of rows) {
      const raw = typeof row.v === "string" ? row.v : null;
      // Les deux formes, `v3:` comprise : voir `ciphertextParts`.
      if (raw === null || ciphertextParts(raw) === null) continue;

      const next = rekeyer.rekey(raw);
      if (next === null) {
        ignorées += 1;
        continue;
      }

      await tx.execute(
        sql.raw(
          `update "${target.table}"` +
            ` set "${target.column}" = ${target.write ? target.write(next) : literal(next)}` +
            ` where "${target.key}" = ${literal(String(row.k))}`,
        ),
      );
      reprises += 1;
      console.log(`  ${target.table}.${target.column} → ${row.k}`);
    }
  }
});

console.log(
  `\n${reprises} secret(s) rechiffré(s), ${ignorées} laissé(s) en l'état (déjà repris ou illisibles).`,
);
process.exit(0);
