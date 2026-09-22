/**
 * Authentification unique : le panel comme **client** d'un fournisseur externe.
 *
 * Le sens compte : ce n'est pas le panel qui délivre des identités, c'est lui
 * qui les reçoit. Le fournisseur — site client, annuaire d'entreprise,
 * Keycloak — reste la source de vérité, et le panel ne fait que reconnaître
 * qui se présente.
 *
 * Conséquence directe : rien de ce que le panel affiche d'un compte SSO n'est
 * modifiable ici. Un nom corrigé dans le panel serait écrasé à la connexion
 * suivante, ce qui est pire qu'un champ en lecture seule.
 */

/** Portées par défaut. OIDC les comprend toutes les trois. */
export const SSO_DEFAULT_SCOPES = "openid profile email";

/**
 * Profil, une fois normalisé.
 *
 * Les fournisseurs ne s'accordent que sur `sub` : Google rend `given_name`,
 * d'autres `firstName`, d'autres encore un seul `name` à découper. La
 * normalisation vit donc ici, en un seul endroit, plutôt qu'éparpillée dans
 * les appelants.
 */
export interface SsoProfile {
  /** Identifiant stable chez le fournisseur. Jamais l'e-mail : il change. */
  subject: string;
  email: string | null;
  /**
   * Vrai seulement si le fournisseur l'affirme.
   *
   * C'est ce drapeau qui autorise à rapprocher le profil d'un compte existant.
   * Le supposer vrai laisserait quiconque déclare l'adresse de quelqu'un
   * d'autre chez un fournisseur laxiste s'emparer de son compte.
   */
  emailVerified: boolean;
  nameFirst: string;
  nameLast: string;
}

export class SsoProfileError extends Error {
  constructor(reason: string) {
    super(`Profil du fournisseur inexploitable : ${reason}`);
    this.name = "SsoProfileError";
  }
}

/**
 * Normalise la réponse d'un endpoint `userinfo`.
 *
 * Tolérante sur le nom, stricte sur l'identifiant : sans `sub`, on ne sait pas
 * **qui** se connecte, et deviner à partir de l'e-mail rattacherait les
 * comptes à une valeur que le fournisseur autorise à changer.
 */
export function normalizeSsoProfile(raw: unknown): SsoProfile {
  if (typeof raw !== "object" || raw === null) throw new SsoProfileError("réponse non objet");
  const claims = raw as Record<string, unknown>;

  const subject = firstString(claims, ["sub", "id", "user_id", "userId"]);
  if (!subject) throw new SsoProfileError("aucun identifiant stable (« sub »)");

  const email = firstString(claims, ["email", "mail", "preferred_username"]);

  // `email_verified` arrive tantôt en booléen, tantôt en chaîne « true » —
  // les deux sont courants, et n'accepter que l'un rejetterait des
  // fournisseurs parfaitement corrects.
  const verifiedClaim = claims.email_verified ?? claims.emailVerified;
  const emailVerified = verifiedClaim === true || verifiedClaim === "true";

  const { nameFirst, nameLast } = splitName(claims);
  return { subject, email, emailVerified, nameFirst, nameLast };
}

function firstString(claims: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    // Certains fournisseurs rendent un identifiant numérique.
    if (typeof value === "number") return String(value);
  }
  return null;
}

/**
 * Prénom et nom, quelle que soit la forme reçue.
 *
 * Un nom vide est acceptable — il s'affiche, il ne décide de rien — là où un
 * refus de connexion pour un champ d'état civil manquant serait absurde.
 */
function splitName(claims: Record<string, unknown>): { nameFirst: string; nameLast: string } {
  const given = firstString(claims, ["given_name", "givenName", "firstName", "first_name"]);
  const family = firstString(claims, ["family_name", "familyName", "lastName", "last_name"]);
  if (given || family) return { nameFirst: given ?? "", nameLast: family ?? "" };

  const full = firstString(claims, ["name", "displayName", "username", "preferred_username"]);
  if (!full) return { nameFirst: "", nameLast: "" };

  // Le premier mot est le prénom, le reste le nom : faux pour une partie du
  // monde, mais c'est un libellé d'affichage, et le fournisseur qui tient à la
  // justesse rend `given_name` et `family_name`.
  const [first, ...rest] = full.split(/\s+/);
  return { nameFirst: first ?? "", nameLast: rest.join(" ") };
}
