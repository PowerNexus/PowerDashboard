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
