/**
 * Reprise du mot de passe d'un compte existant.
 *
 * Le pendant assumé de `create-admin.mts`, qui refuse au contraire de toucher
 * à une adresse déjà connue — pour qu'une livraison relancée ne réinitialise
 * jamais un compte en service. Ce refus est bon, mais il laissait
 * l'exploitant qui a perdu son mot de passe sans autre recours qu'un `update`
 * écrit à la main en SQL, avec un condensat fabriqué à côté.
 *
 *   pnpm --filter @gamedashboard/api exec tsx scripts/reset-password.mts <email>
 *
 * Le mot de passe est **tiré au sort et affiché une fois**, comme à la
 * création : un mot de passe passé en argument reste dans l'historique du
 * shell, et un mot de passe choisi pour un compte de secours est presque
 * toujours un mot de passe déjà employé ailleurs. Comme à la création, il est
 * provisoire : valable vingt-quatre heures, et à changer à la connexion.
 *
 * Ce script ne touche qu'à `password_hash`. Les sessions ouvertes, la double
 * authentification et les clés d'API **survivent** — c'est une reprise de mot
 * de passe, pas une mise à la porte. Qui veut fermer les accès a besoin d'un
 * geste distinct, et le fait exprès.
 */
import {
  hashPassword,
  PROVISIONAL_PASSWORD_TTL_MS,
  provisionalPassword,
} from "@gamedashboard/auth";
import { createClient, users } from "@gamedashboard/db";
import { eq } from "drizzle-orm";

const [email] = process.argv.slice(2);

if (!email) {
  console.error("Usage : reset-password.mts <email>");
  process.exit(1);
}

const db = createClient();

const [compte] = await db
  .select({ id: users.id, role: users.role, is2fa: users.isTwoFactorEnabled })
  .from(users)
  .where(eq(users.email, email))
  .limit(1);

/*
 * Un compte inconnu est une erreur, pas une création silencieuse.
 *
 * Une faute de frappe dans l'adresse créerait sinon un second administrateur
 * que personne n'attend, pendant que celui qu'on voulait dépanner reste
 * dehors — et l'on chercherait longtemps pourquoi le mot de passe affiché ne
 * marche pas.
 */
if (!compte) {
  console.error(`Aucun compte pour ${email} : rien n'a été modifié.`);
  process.exit(1);
}

/**
 * Le mot de passe : tiré au sort, sauf si l'environnement en impose un.
 *
 * **Par l'environnement et jamais par un argument.** Un mot de passe passé en
 * argument reste dans l'historique du shell et dans la liste des processus,
 * où n'importe qui sur la machine peut le lire. Une variable d'environnement
 * n'a ni l'un ni l'autre défaut, et c'est par elle que voyagent les secrets
 * d'une intégration continue.
 *
 * Le seul usage prévu est justement celui-là : la CI a besoin d'un compte
 * dont elle connaît le mot de passe pour jouer le parcours de connexion. Un
 * exploitant qui dépanne un compte n'a aucune raison de s'en servir — le tirage
 * au sort lui évite de réemployer un mot de passe qu'il connaît déjà.
 *
 * Un mot de passe imposé n'expire pas : ce n'est pas un secret initial tiré
 * par le panel, et la CI joue la connexion avec — le forcer au changement
 * casserait sa suite. Seul le mot de passe tiré au sort est provisoire.
 */
const impose = process.env.GD_PASSWORD;
const { password, expiresAt, imposed } = provisionalPassword(impose);

if (impose?.trim() && !imposed) {
  console.error("GD_PASSWORD fait moins de douze caractères : ignorée, tirage au sort.");
}

await db
  .update(users)
  .set({
    passwordHash: await hashPassword(password),
    // Posée ou levée : un mot de passe imposé remplace aussi un provisoire.
    passwordExpiresAt: expiresAt?.toISOString() ?? null,
    updatedAt: new Date().toISOString(),
  })
  .where(eq(users.id, compte.id));

console.log(`Mot de passe repris pour ${email} (rôle ${compte.role}).`);
if (imposed) {
  console.log("Mot de passe imposé par GD_PASSWORD : sans échéance.");
} else {
  console.log(`Mot de passe provisoire : ${password}`);
  console.log(
    `Valable ${PROVISIONAL_PASSWORD_TTL_MS / 3_600_000} heures : à changer à la première connexion.`,
  );
}

if (compte.is2fa) {
  console.log(
    "\nLa double authentification reste active : le code de l'application sera demandé après ce mot de passe.",
  );
}

process.exit(0);
