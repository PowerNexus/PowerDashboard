import { hash, parseOptions, verify } from "@node-rs/argon2";

/**
 * Hachage des mots de passe (§5.1 du plan).
 *
 * Argon2id et non bcrypt : bcrypt tronque silencieusement au-delà de 72 octets,
 * ce qui rend deux mots de passe longs différents équivalents, et sa résistance
 * au calcul parallèle sur GPU est faible faute de coût mémoire.
 *
 * Les paramètres suivent la recommandation OWASP. Ils sont exportés et non
 * enfouis dans les appels : ils devront être relevés à mesure que le matériel
 * progresse, et `needsRehash` permet de le faire progressivement, à la
 * connexion, sans demander à personne de changer de mot de passe.
 */
export const ARGON2_OPTIONS = {
  /** Argon2id : résiste à la fois aux attaques par canal auxiliaire et au GPU. */
  algorithm: 2,
  /** 19 MiB. Le coût mémoire est ce qui rend l'attaque massivement parallèle chère. */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Vérifie un mot de passe contre son condensat.
 *
 * Un condensat illisible — colonne corrompue, migration ratée, valeur écrite
 * par un autre outil — renvoie `false` plutôt que de propager une exception :
 * la connexion doit échouer proprement, et le détail part dans les journaux,
 * pas dans la réponse HTTP.
 */
export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  // Un condensat repris d'un panel Pterodactyl est en bcrypt. Il est vérifié
  // une fois, puis remplacé : voir `estBcrypt` et `needsRehash`.
  if (estBcrypt(digest)) return verifyBcrypt(digest, password);

  try {
    return await verify(digest, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Reconnaît un condensat bcrypt à son en-tête.
 *
 * **Pourquoi bcrypt figure ici alors que le panel n'en produit jamais.** La
 * reprise d'un panel Pterodactyl amène des comptes dont les mots de passe sont
 * hachés en bcrypt, et personne ne connaît le mot de passe en clair — pas même
 * leur propriétaire, qui l'a en mémoire mais ne nous l'a pas donné. Les deux
 * autres issues étaient pires : refuser les condensats importés obligerait
 * chaque client à passer par « mot de passe oublié » le jour de la bascule,
 * c'est-à-dire le jour où le support est déjà saturé ; et migrer sans mot de
 * passe fermerait les comptes.
 *
 * Le condensat bcrypt ne survit pas à la première connexion : `needsRehash` le
 * déclare périmé, et le contrôleur le remplace par un Argon2id à l'instant où
 * le mot de passe est en clair. Le parc se convertit donc de lui-même, sans
 * que personne ait à faire quoi que ce soit.
 *
 * Les trois variantes `$2a$`, `$2b$` et `$2y$` sont acceptées : elles ne
 * diffèrent que par leur traitement d'un défaut historique sur les caractères
 * non ASCII, et Pterodactyl a émis les trois selon les versions de PHP.
 */
function estBcrypt(digest: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(digest);
}

/**
 * Vérifie un condensat bcrypt.
 *
 * `bcryptjs` et non `bcrypt` : le second est un module natif, qui se recompile
 * à chaque montée de version de Node et casse les constructions là où on s'y
 * attend le moins. Le premier est en JavaScript pur — plus lent, ce qui est
 * sans importance ici : cette vérification n'a lieu qu'une fois par compte
 * repris, à sa première connexion.
 *
 * L'import est **différé** pour la même raison : rien ne justifie de charger un
 * algorithme que le panel n'emploie jamais, sur chaque démarrage de chaque
 * processus, pour des comptes qui n'existent peut-être pas.
 */
async function verifyBcrypt(digest: string, password: string): Promise<boolean> {
  try {
    const bcrypt = await import("bcryptjs");
    return await bcrypt.compare(password, digest);
  } catch {
    // Paquet absent, condensat malformé : la connexion échoue proprement, et
    // le compte passe par « mot de passe oublié ».
    return false;
  }
}

/**
 * Indique qu'un condensat a été produit avec des paramètres plus faibles que
 * les paramètres courants. À appeler après une vérification réussie : c'est le
 * seul instant où le mot de passe en clair est disponible pour le rehacher.
 *
 * La comparaison est faite ici à partir de `parseOptions` plutôt que confiée à
 * la bibliothèque, qui n'expose pas cette fonction. Chaque paramètre est
 * comparé séparément : un condensat n'est périmé que s'il est *plus faible*,
 * jamais parce qu'il diffère. Un condensat plus coûteux que le réglage courant
 * — après une baisse volontaire des paramètres, par exemple — reste valable, et
 * le remplacer l'affaiblirait.
 */
export function needsRehash(digest: string): boolean {
  let parsed: ReturnType<typeof parseOptions>;
  try {
    parsed = parseOptions(digest);
  } catch {
    /*
     * Illisible : à remplacer à la première occasion.
     *
     * C'est par ici que passent les condensats **bcrypt** repris d'un panel
     * Pterodactyl — `parseOptions` ne sait pas les lire, et c'est exactement
     * ce qu'on veut : ils sont déclarés périmés, donc réécrits en Argon2id dès
     * la première connexion réussie. Le parc importé se convertit ainsi de
     * lui-même, sans qu'on demande quoi que ce soit à personne.
     */
    return true;
  }

  return (
    parsed.algorithm !== ARGON2_OPTIONS.algorithm ||
    parsed.memoryCost < ARGON2_OPTIONS.memoryCost ||
    parsed.timeCost < ARGON2_OPTIONS.timeCost ||
    parsed.parallelism < ARGON2_OPTIONS.parallelism
  );
}
