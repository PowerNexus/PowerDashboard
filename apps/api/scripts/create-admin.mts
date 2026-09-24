/**
 * Création du premier administrateur.
 *
 * Une base fraîchement migrée n'a aucun compte, et il n'existe pas d'écran
 * d'installation : sans ce script, le panel est inaccessible à son propre
 * propriétaire.
 *
 *   pnpm --filter @gamedashboard/api exec tsx scripts/create-admin.mts <email> <prénom> <nom>
 *
 * Le mot de passe n'est pas demandé mais **tiré au sort et affiché une fois**.
 * Deux raisons : un mot de passe saisi en ligne de commande reste dans
 * l'historique du shell, et un mot de passe choisi pour un compte de secours
 * est presque toujours un mot de passe déjà utilisé ailleurs.
 *
 * Il est **provisoire** : valable vingt-quatre heures, et la connexion demande
 * d'en changer tant qu'il sert (ASVS 2.3.1, voir `provisionalPassword`). Le
 * script ne crée rien si l'adresse existe déjà : relancer une livraison ne
 * doit jamais réinitialiser le mot de passe d'un compte en service.
 */
import {
  hashPassword,
  PROVISIONAL_PASSWORD_TTL_MS,
  provisionalPassword,
} from "@gamedashboard/auth";
import { createClient, users } from "@gamedashboard/db";
import { eq } from "drizzle-orm";

const [email, nameFirst, nameLast] = process.argv.slice(2);

const db = createClient();

if (!email || !nameFirst || !nameLast) {
  console.error("Usage : create-admin.mts <email> <prénom> <nom>");
  process.exit(1);
}

const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
if (existing.length > 0) {
  console.log(`Le compte ${email} existe déjà : rien n'a été modifié.`);
  process.exit(0);
}

const { password, expiresAt } = provisionalPassword();

await db.insert(users).values({
  email,
  passwordHash: await hashPassword(password),
  passwordExpiresAt: expiresAt?.toISOString() ?? null,
  nameFirst,
  nameLast,
  role: "admin",
  // L'adresse n'est pas vérifiée par un envoi ici : c'est le compte de
  // l'exploitant, créé depuis sa propre machine. Le marquer vérifié évite de
  // le bloquer derrière un courriel qui n'a jamais été envoyé.
  emailVerifiedAt: new Date().toISOString(),
});

console.log(`Administrateur créé : ${email}`);
// Cette ligne est lue telle quelle par `infra/prod/installer.sh`.
console.log(`Mot de passe provisoire : ${password}`);
console.log(
  `Valable ${PROVISIONAL_PASSWORD_TTL_MS / 3_600_000} heures : à changer à la première connexion.`,
);
process.exit(0);
