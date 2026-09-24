/**
 * Ce qu'une politique de mot de passe peut reprocher à une saisie.
 *
 * Le type vit ici, et non dans `@gamedashboard/auth`, parce qu'il circule sur le
 * réseau : l'API le renvoie, l'interface le traduit. `@gamedashboard/auth` embarque
 * argon2, une extension native ; en faire dépendre le paquet web pour un type
 * ferait entrer une bibliothèque de chiffrement serveur dans la construction
 * du navigateur, pour rien.
 *
 * Les `kind` sont des identifiants stables et non des messages. La phrase
 * française correspondante vit dans le catalogue de traductions, où elle peut
 * changer sans que l'API ait à bouger. Les nombres accompagnent le manquement
 * pour que la phrase reste exacte le jour où le minimum change : « au moins 12
 * caractères » écrit en dur mentirait dès la ligne suivante.
 */
export type PasswordProblem =
  | { kind: "too-short"; minimum: number }
  | { kind: "too-long"; maximum: number }
  | { kind: "contains-identity" }
  | { kind: "pwned"; occurrences: number };

/**
 * Politique de mot de passe (§5.1) : ce qui se juge sans réseau.
 *
 * Longueur minimale plutôt que classes de caractères imposées : exiger une
 * majuscule, un chiffre et un symbole produit surtout des « Motdepasse1! »,
 * prévisibles pour un attaquant et pénibles pour tout le monde. La longueur et
 * la vérification des fuites (côté serveur, `checkPassword`) protègent
 * davantage.
 *
 * Ici et non dans `@gamedashboard/auth` : la jauge de force de l'interface
 * applique la même règle, et le paquet web n'a pas à embarquer argon2.
 */
export const PASSWORD_MIN_LENGTH = 12;
/** Argon2 accepte davantage, mais une entrée démesurée est un vecteur de déni de service. */
export const PASSWORD_MAX_LENGTH = 256;

/**
 * Contrôles réalisables sans appel réseau.
 *
 * `identity` reçoit l'e-mail et le nom : un mot de passe qui les contient est
 * la première chose qu'un attaquant essaie, et aucune règle de complexité ne
 * l'en empêche.
 */
export function checkPasswordShape(
  password: string,
  identity: readonly string[] = [],
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];

  // La longueur se mesure en points de code : « é » ou un emoji comptent pour
  // un caractère aux yeux de l'utilisateur, alors que `.length` compterait
  // deux unités et laisserait passer un mot de passe plus court qu'annoncé.
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    problems.push({ kind: "too-short", minimum: PASSWORD_MIN_LENGTH });
  }
  if (length > PASSWORD_MAX_LENGTH) {
    problems.push({ kind: "too-long", maximum: PASSWORD_MAX_LENGTH });
  }

  const lowered = password.toLowerCase();
  const found = identity.some((raw) => {
    const part = raw.toLowerCase().trim();
    // Les fragments très courts produiraient des refus incompréhensibles.
    return part.length >= 4 && lowered.includes(part);
  });
  if (found) problems.push({ kind: "contains-identity" });

  return problems;
}

/** Séparateur du nom d'utilisateur et du domaine, pour éclater une adresse. */
const IDENTITY_SPLIT = /[@._\-\s]+/;

/** Fragments d'identité exploitables, tirés de l'e-mail et du nom. */
export function identityFragments(email: string, ...names: string[]): string[] {
  return [...email.split(IDENTITY_SPLIT), ...names]
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Longueurs à partir desquelles la jauge monte d'un cran.
 *
 * Le minimum est celui de la politique ; au-delà, chaque quatre caractères
 * gagnés vaut un cran. La longueur seule, comme la politique : récompenser
 * une majuscule ou un symbole enseignerait exactement les « Motdepasse1! »
 * qu'elle a renoncé à exiger.
 */
const GOOD_LENGTH = PASSWORD_MIN_LENGTH + 4;
const STRONG_LENGTH = PASSWORD_MIN_LENGTH + 8;

/**
 * Ce que la jauge dit d'une saisie (ASVS 2.1.8).
 *
 * Trois refus que l'API prononcerait aussi — trop court, trop long, identité
 * — et trois crans d'acceptation. Ce qui ne se juge qu'au serveur, la
 * présence dans les fuites connues, n'y figure pas : l'écran le dit à part.
 */
export type PasswordStrength =
  | { verdict: "empty"; level: 0 }
  | { verdict: "too-short"; level: 1; length: number; minimum: number }
  | { verdict: "too-long" | "contains-identity"; level: 1 }
  | { verdict: "acceptable"; level: 2 }
  | { verdict: "good"; level: 3 }
  | { verdict: "strong"; level: 4 };

/** Nombre de crans de la jauge. */
export const PASSWORD_STRENGTH_LEVELS = 4;

export function passwordStrength(
  password: string,
  identity: readonly string[] = [],
): PasswordStrength {
  if (password === "") return { verdict: "empty", level: 0 };

  // Les refus d'abord, dans l'ordre où l'API les formulerait : la jauge ne
  // doit jamais promettre ce que la route refusera.
  const problems = checkPasswordShape(password, identity);
  const length = [...password].length;
  if (problems.some((problem) => problem.kind === "too-long")) {
    return { verdict: "too-long", level: 1 };
  }
  if (problems.some((problem) => problem.kind === "too-short")) {
    return { verdict: "too-short", level: 1, length, minimum: PASSWORD_MIN_LENGTH };
  }
  if (problems.length > 0) return { verdict: "contains-identity", level: 1 };

  if (length >= STRONG_LENGTH) return { verdict: "strong", level: 4 };
  if (length >= GOOD_LENGTH) return { verdict: "good", level: 3 };
  return { verdict: "acceptable", level: 2 };
}
