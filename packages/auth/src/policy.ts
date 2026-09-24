import { createHash } from "node:crypto";
import { checkPasswordShape, type PasswordProblem } from "@gamedashboard/contracts";

/**
 * Politique de mot de passe (§5.1).
 *
 * Longueur minimale plutôt que classes de caractères imposées : exiger une
 * majuscule, un chiffre et un symbole produit surtout des « Motdepasse1! »,
 * prévisibles pour un attaquant et pénibles pour tout le monde. La longueur et
 * la vérification des fuites protègent davantage.
 *
 * Les contrôles réalisables sans réseau — longueur, identité — vivent dans
 * `@gamedashboard/contracts` : la jauge de force de l'interface les applique
 * aussi, et une seconde copie finirait par annoncer « acceptable » un mot de
 * passe que l'API refuse. Ils sont réexportés ici pour que les appelants côté
 * serveur n'aient pas deux paquets à connaître ; ne reste ici que ce qui
 * demande le réseau ou argon2.
 */
export {
  checkPasswordShape,
  identityFragments,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordProblem,
} from "@gamedashboard/contracts";

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * Nombre d'apparitions du mot de passe dans les fuites connues, via l'API
 * HaveIBeenPwned en k-anonymat.
 *
 * Le mot de passe ne quitte jamais le serveur : seuls les cinq premiers
 * caractères de son empreinte SHA-1 sont envoyés, et la comparaison du reste
 * se fait ici. HIBP ne peut donc pas savoir lequel a été testé.
 *
 * SHA-1 n'est pas un choix de sécurité — c'est le format imposé par l'API.
 * Il ne sert qu'à interroger un index, jamais à stocker quoi que ce soit.
 */
export async function pwnedCount(password: string, fetchImpl: FetchLike): Promise<number> {
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
    // Ajoute des réponses factices pour que la taille du corps ne trahisse pas
    // le nombre de correspondances à un observateur du réseau.
    headers: { "Add-Padding": "true" },
  });
  if (!response.ok) {
    throw new Error(`HaveIBeenPwned a répondu ${response.status}`);
  }

  for (const line of (await response.text()).split("\n")) {
    const [candidate, count] = line.trim().split(":");
    if (candidate !== suffix) continue;
    const occurrences = Number.parseInt(count ?? "0", 10);
    // Le remplissage ajoute des entrées à zéro occurrence : ce ne sont pas
    // de vraies correspondances, les compter ferait refuser des mots de
    // passe parfaitement sains.
    return Number.isNaN(occurrences) ? 0 : occurrences;
  }
  return 0;
}

/**
 * Politique complète. L'indisponibilité de HIBP ne bloque pas l'inscription :
 * refuser un mot de passe valide parce qu'un service tiers est en panne
 * pénalise l'utilisateur sans rien protéger. L'appelant est informé par
 * `pwnedCheckFailed` et peut le journaliser.
 */
export async function checkPassword(
  password: string,
  options: { identity?: readonly string[]; fetchImpl?: FetchLike } = {},
): Promise<{ problems: PasswordProblem[]; pwnedCheckFailed: boolean }> {
  const problems = checkPasswordShape(password, options.identity ?? []);
  if (!options.fetchImpl) return { problems, pwnedCheckFailed: false };

  try {
    const occurrences = await pwnedCount(password, options.fetchImpl);
    if (occurrences > 0) problems.push({ kind: "pwned", occurrences });
    return { problems, pwnedCheckFailed: false };
  } catch {
    return { problems, pwnedCheckFailed: true };
  }
}
