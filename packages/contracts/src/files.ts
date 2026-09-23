import { z } from "zod";

/**
 * Règles du gestionnaire de fichiers, partagées par l'API et l'écran.
 *
 * Elles vivent ici plutôt que dans l'un ou l'autre : l'écran refuse tôt, pour
 * dire quoi corriger sans aller-retour, et l'API refuse quoi qu'il arrive,
 * parce qu'un intégrateur l'appelle sans passer par l'écran. Deux copies de
 * la même règle finiraient par ne plus dire la même chose.
 */

/* --- Permissions (chmod) --------------------------------------------------- */

/**
 * Un mode de fichier : trois chiffres octaux, de `000` à `777`.
 *
 * **Chaîne, et non nombre** : c'est le contrat du daemon. Relevé dans la
 * source de Wings (`router/router_server_files.go`, `postServerChmodFile`) :
 * `chmodFile.Mode` est un `string` que le daemon passe à
 * `strconv.ParseUint(p.Mode, 8, 32)`. Un nombre JSON ferait échouer le
 * décodage du corps entier ; `"0755"` passerait, `755` non.
 *
 * **Trois chiffres, jamais quatre.** Le quatrième porterait setuid, setgid et
 * le bit collant. Un serveur de jeu n'en a aucun usage, et un exécutable
 * setuid déposé par un client dans son volume est exactement le genre de
 * porte qu'on ne veut pas laisser entrouverte — même si le conteneur la
 * referme en principe. Le daemon, lui, ne refuse rien : il convertit
 * `os.FileMode(mode)` sans filtre. Le refus est donc de notre côté.
 */
export const FileMode = z
  .string()
  .regex(/^[0-7]{3}$/, "Le mode s'écrit en trois chiffres octaux, de 000 à 777.");
export type FileMode = z.infer<typeof FileMode>;

/**
 * Un nom d'entrée existante, relatif au dossier : ni vide, ni fait d'espaces.
 *
 * Vérifié sans être rogné : il désigne un fichier qui existe, et un nom qui se
 * termine réellement par une espace doit arriver au daemon tel quel.
 */
const EntryName = z.string().refine((s) => s.trim() !== "", "Nom de fichier manquant.");

/**
 * Corps de `POST /api/v1/client/servers/:id/files/chmod`.
 *
 * Même forme que celle du daemon, à dessein : `root` est le dossier, chaque
 * `file` est relatif à lui. Le panel relaie sans traduire, ce qui laisse au
 * daemon le confinement des chemins — c'est lui qui le fait bien (§4.3).
 *
 * Le plafond de cent entrées n'est pas un contrat du daemon, qui traite la
 * liste en parallèle sans borne : c'est ce qui l'empêche de recevoir d'un seul
 * appel des milliers de goroutines pour une requête que l'écran n'envoie
 * jamais à plus d'une entrée.
 */
export const ChmodRequest = z.object({
  root: z.string(),
  files: z
    .array(z.object({ file: EntryName, mode: FileMode }).strict())
    .min(1, "Aucun fichier à modifier.")
    .max(100, "Pas plus de cent fichiers à la fois."),
});
export type ChmodRequest = z.infer<typeof ChmodRequest>;

/** Les neuf bits de permission, dans l'ordre où `ls -l` les écrit. */
export type ModeBits = {
  [Who in "owner" | "group" | "others"]: { read: boolean; write: boolean; execute: boolean };
};

const CLASSES = ["owner", "group", "others"] as const;

/**
 * Le mode octal d'une entrée, lu dans ce que le listage de Wings affiche.
 *
 * Le daemon rend `mode` sous la forme de `os.FileMode.String()` en Go :
 * des lettres de type en tête (`d`, `L`, `u` pour setuid…) puis **toujours**
 * neuf caractères `rwx` ou `-`. Seuls ces neuf derniers comptent ; les lire
 * depuis le début décalerait tout d'un cran pour un dossier (`drwxr-xr-x`).
 *
 * Rend `null` pour une chaîne qui n'a pas cette forme : mieux vaut un champ
 * vide que l'écran propose de « garder » un mode inventé.
 */
export function octalFromSymbolic(symbolic: string): FileMode | null {
  const perms = symbolic.slice(-9);
  if (!/^[r-][w-][xsStT-][r-][w-][xsStT-][r-][w-][xsStT-]$/.test(perms)) return null;
  let out = "";
  for (let i = 0; i < 9; i += 3) {
    const read = perms[i] === "r" ? 4 : 0;
    const write = perms[i + 1] === "w" ? 2 : 0;
    // `s` et `t` (formes Unix) disent « exécutable, et bit spécial » ; `S` et
    // `T` disent « bit spécial seul ». Le bit spécial n'est pas repris : on ne
    // sait pas l'écrire, et on n'a pas à le proposer.
    const execute = "xst".includes(perms[i + 2] ?? "-") ? 1 : 0;
    out += String(read + write + execute);
  }
  return out;
}

export function modeToBits(mode: FileMode): ModeBits {
  const digits = mode.split("").map(Number);
  const bits = {} as ModeBits;
  CLASSES.forEach((who, index) => {
    const d = digits[index] ?? 0;
    bits[who] = { read: (d & 4) !== 0, write: (d & 2) !== 0, execute: (d & 1) !== 0 };
  });
  return bits;
}

export function bitsToMode(bits: ModeBits): FileMode {
  return CLASSES.map((who) => {
    const b = bits[who];
    return String((b.read ? 4 : 0) + (b.write ? 2 : 0) + (b.execute ? 1 : 0));
  }).join("");
}

/* --- Renommer / déplacer ---------------------------------------------------- */

/**
 * Pourquoi une cible de renommage est refusée avant d'atteindre le daemon.
 *
 * - `empty` : rien à la place du nom — le daemon renommerait vers le dossier
 *   lui-même, et répondrait « la destination existe déjà », ce qui n'explique
 *   rien ;
 * - `trailingSlash` : `plugins/` se lit « dans le dossier plugins », mais le
 *   daemon le prend pour un nom et renomme l'entrée *en* `plugins` ;
 * - `unchanged` : même nom qu'avant, un appel pour rien.
 */
export type RenameRefusal = "empty" | "trailingSlash" | "unchanged";

/**
 * Vérifie une cible de renommage ou de déplacement.
 *
 * `to` est relatif au dossier courant, comme `from` : `mondes/ancien` déplace
 * dans un sous-dossier, `../sauvegardes/x.zip` remonte d'un cran. Le daemon
 * confine le résultat au volume du serveur ; ce n'est pas le rôle de cette
 * fonction, et le prétendre donnerait l'illusion d'une protection qui n'est
 * pas là (§4.3).
 */
export function renameRefusal(from: string, to: string): RenameRefusal | null {
  const cible = to.trim();
  if (cible === "" || cible === "." || cible === "/") return "empty";
  if (cible.endsWith("/")) return "trailingSlash";
  if (cible === from) return "unchanged";
  return null;
}

const RENAME_REFUSAL_MESSAGES: Record<RenameRefusal, string> = {
  empty: "Nouveau nom manquant.",
  trailingSlash:
    "Le nouveau nom se termine par « / » : indiquez le chemin complet, nom du fichier compris.",
  unchanged: "Le nouveau nom est identique à l'ancien.",
};

/** Corps de `POST /api/v1/client/servers/:id/files/rename`. */
export const RenameRequest = z
  .object({ root: z.string(), from: EntryName, to: z.string() })
  .superRefine((value, ctx) => {
    const refus = renameRefusal(value.from, value.to);
    if (refus) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: RENAME_REFUSAL_MESSAGES[refus],
      });
    }
  })
  // La cible part débarrassée de ses espaces : « x.txt  » n'est pas un nom
  // que quiconque a voulu donner, et le daemon le créerait tel quel.
  .transform((value) => ({ ...value, to: value.to.trim() }));
export type RenameRequest = z.infer<typeof RenameRequest>;

/**
 * Le refus que Wings écrit quand la destination existe déjà.
 *
 * Relevé dans `putServerRenameFiles` : un 400 portant exactement cette phrase.
 * L'API la reconnaît pour la remplacer par un refus lisible ; si une version
 * future du daemon la reformule, on retombe simplement sur son texte brut.
 */
export const WINGS_RENAME_COLLISION = "Cannot move or rename file, destination already exists.";
