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
 * Il est à changer à la première connexion. Le script ne crée rien si
 * l'adresse existe déjà : relancer une livraison ne doit jamais réinitialiser
 * le mot de passe d'un compte en service.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "@gamedashboard/auth";
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

// base64url : pas de caractère qu'un terminal ou un copier-coller abîme.
const password = randomBytes(24).toString("base64url");

await db.insert(users).values({
  email,
  passwordHash: await hashPassword(password),
  nameFirst,
  nameLast,
  role: "admin",
  // L'adresse n'est pas vérifiée par un envoi ici : c'est le compte de
  // l'exploitant, créé depuis sa propre machine. Le marquer vérifié évite de
  // le bloquer derrière un courriel qui n'a jamais été envoyé.
  emailVerifiedAt: new Date().toISOString(),
});

console.log(`Administrateur créé : ${email}`);
console.log(`Mot de passe provisoire : ${password}`);
console.log("À changer à la première connexion.");
process.exit(0);
