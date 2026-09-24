/**
 * Rechiffrement des secrets : changement du sel de dérivation, rotation de la
 * clé maître, et liaison de chaque secret à sa ligne.
 *
 * Le sel de `scrypt` n'est pas une étiquette : il décide de la clé dérivée. Le
 * changer rend illisible, d'un coup, tout ce qui a été chiffré avant — jetons
 * de daemon, mots de passe de bases, secrets TOTP et de webhooks. Il n'existe
 * pas de raccourci : il faut déchiffrer avec l'ancien sel puis rechiffrer avec
 * le nouveau, valeur par valeur.
 *
 *   pnpm --filter @gamedashboard/api exec tsx scripts/rekey-secrets.mts
 *
 * Chaque valeur réécrite est **liée à sa ligne** (forme `v4:`, contexte
 * `<table>.<colonne>:<clé>`, audit ASVS NC-18) : recopiée sur une autre ligne,
 * elle ne se relit plus. Les valeurs écrites avant la liaison (`v3:` ou sans
 * préfixe) se lient au passage. Avec la même clé et le même sel des deux
 * côtés, le script ne fait que cela.
 *
 * Trois propriétés dont dépend la sûreté de l'opération :
 *
 * 1. **Les deux sels sont écrits ici**, et le script n'importe pas
 *    `encryptSecret`. Il ne dépend donc pas de la version déployée de la
 *    bibliothèque : pour un changement de sel, on le lance *avant* de mettre
 *    le nouveau code en ligne. La forme liée, elle, n'est lue que par une API
 *    qui la connaît : ne jamais lancer ce script contre une API antérieure à
 *    la liaison (runbook de la clé maître).
 * 2. **Il est idempotent par construction.** Une valeur qui ne se déchiffre pas
 *    avec l'ancienne clé est laissée telle quelle — GCM authentifie, donc une
 *    valeur déjà reprise échoue franchement au lieu de rendre des octets
 *    arbitraires. Une valeur déjà liée n'est pas réécrite quand la clé ne
 *    change pas. Le relancer sur une base déjà reprise ne fait rien.
 * 3. **Une valeur liée à une autre ligne n'est jamais reprise** : elle a été
 *    recopiée, et la rechiffrer sous le contexte de sa ligne actuelle
 *    blanchirait la permutation. Elle est comptée parmi les illisibles.
 *
 * Tout passe dans **une transaction** : une reprise à moitié faite laisserait
 * une base dont une partie se lit et l'autre non, sans moyen de savoir
 * laquelle. Les lignes lues sont verrouillées (`for update`) : une écriture de
 * l'API pendant la reprise attend la fin de celle-ci au lieu d'être écrasée
 * par la valeur lue avant elle.
 *
 * Hors de portée, et volontairement : le jeton d'étape intermédiaire de
 * connexion (`login-challenge`), qui est chiffré lui aussi mais ne vit que
 * quelques minutes dans le navigateur. Au pire, une connexion en cours au
 * moment de la bascule est à recommencer.
 */
import { createClient } from "@gamedashboard/db";
import { sql } from "drizzle-orm";
import {
  createRekeyer,
  parseCiphertext,
  REKEY_TARGETS,
  sqlLiteral,
  targetContext,
} from "../src/common/rekey";

/**
 * D'où l'on vient, où l'on va.
 *
 * Trois reprises possibles avec le même script :
 * - **changement de sel** (l'incident d'origine) : `APP_SECRET_KEY` seule,
 *   `FROM_SALT` vaut par défaut l'ancien sel ;
 * - **rotation de la clé maître** (§5.4) : `APP_SECRET_KEY_OLD` porte la clé
 *   compromise, `APP_SECRET_KEY` la nouvelle, et le sel est le même des deux
 *   côtés (`FROM_SALT=gamedashboard.secrets.v2`) ;
 * - **liaison seule** : `APP_SECRET_KEY` seule et
 *   `FROM_SALT=gamedashboard.secrets.v2` — rien ne change de clé, les
 *   valeurs d'avant la liaison sont liées à leur ligne.
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
  console.log("Même clé et même sel : les secrets sont seulement liés à leur ligne.\n");
}

const rekeyer = createRekeyer({
  fromSecret: OLD_SECRET,
  fromSalt: FROM_SALT,
  toSecret: SECRET,
  toSalt: TO_SALT,
});

const db = createClient();
let reprises = 0;
let aJour = 0;
let illisibles = 0;

await db.transaction(async (tx) => {
  for (const target of REKEY_TARGETS) {
    /*
     * Une table absente est signalée, pas fatale.
     *
     * Le catalogue vaut pour le schéma complet ; une base peut être en retard
     * d'une migration, ou une table avoir changé de nom. Sans ce contrôle, la
     * première table manquante annule la transaction — et la reprise de
     * toutes les autres avec elle, pour une raison qui n'a rien à voir avec
     * le chiffrement.
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
          (target.where ? ` where ${target.where}` : "") +
          " for update",
      ),
    )) as unknown as { k: string; v: unknown }[];

    for (const row of rows) {
      const raw = typeof row.v === "string" ? row.v : null;
      // Les trois formes, `v3:` et `v4:` comprises : voir `parseCiphertext`.
      if (raw === null || parseCiphertext(raw) === null) continue;

      const context = targetContext(target, String(row.k));
      const next = rekeyer.rekey(raw, context);
      if (next === null) {
        if (rekeyer.isCurrent(raw, context)) {
          aJour += 1;
        } else {
          illisibles += 1;
          console.log(
            `  ${target.table}.${target.column} → ${row.k} : ILLISIBLE, laissé en l'état`,
          );
        }
        continue;
      }

      await tx.execute(
        sql.raw(
          `update "${target.table}"` +
            ` set "${target.column}" = ${target.write ? target.write(next) : sqlLiteral(next)}` +
            ` where "${target.key}" = ${sqlLiteral(String(row.k))}`,
        ),
      );
      reprises += 1;
      console.log(`  ${target.table}.${target.column} → ${row.k}`);
    }
  }
});

console.log(
  `\n${reprises} secret(s) rechiffré(s), ${aJour} déjà à jour, ${illisibles} illisible(s) laissé(s) en l'état.`,
);
if (illisibles > 0) {
  console.log(
    "Des valeurs ne se relisent ni avec l'ancienne clé ni avec la nouvelle, ou sont liées à une autre ligne (recopiées). Les examiner avant de changer de clé.",
  );
}
process.exit(0);
