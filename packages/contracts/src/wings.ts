import { z } from "zod";

/**
 * Contrat que Wings impose au panel.
 *
 * Wings n'est pas modifié (§4.3 du plan) : ces formes ne sont donc pas des
 * choix de conception, ce sont des obligations. Elles ont été relevées dans la
 * source du daemon — paquet `remote/` — et non déduites de la documentation,
 * qui décrit l'intention plutôt que ce que le programme fait réellement.
 *
 * Toute traduction entre notre modèle et celui-ci se fait dans le module
 * `remote` de l'API, nulle part ailleurs.
 *
 * Référence : pterodactyl/wings, `remote/http.go`, `remote/servers.go`,
 * `remote/types.go`, `remote/errors.go`.
 */

/** Version du daemon dont le contrat a été relevé. */
export const WINGS_CONTRACT_REF = "pterodactyl/wings@d611682 (2026-08-14)";

/**
 * Préfixe des routes que le panel doit servir.
 *
 * Sans numéro de version, contrairement à `/api/v1/` pour nos propres routes :
 * Wings construit son URL de base en concaténant l'adresse du panel et
 * `/api/remote`, ce que nous ne pouvons pas changer.
 */
export const WINGS_REMOTE_PREFIX = "/api/remote";

/** Wings négocie ce type de média ; y répondre en `application/json` nu suffit. */
export const WINGS_ACCEPT = "application/vnd.pterodactyl.v1+json";

/**
 * Le jeton présenté par Wings est en deux parties séparées par un point :
 * `Authorization: Bearer <identifiant>.<secret>`.
 *
 * C'est la raison d'être des trois colonnes de `nodes` (§5.5) : l'identifiant
 * retrouve la ligne en une lecture indexée, le secret est comparé au condensat.
 * Traiter l'ensemble comme un jeton opaque obligerait à parcourir tous les
 * nodes et à comparer chaque condensat à chaque requête.
 */
export const WINGS_TOKEN_SEPARATOR = ".";

export interface WingsToken {
  id: string;
  secret: string;
}

/**
 * Découpe l'en-tête d'autorisation présenté par Wings.
 *
 * Le découpage se fait au **premier** point seulement : un secret contenant un
 * point resterait intact, là où un `split(".")` naïf le tronquerait et ferait
 * échouer une authentification pourtant valide.
 */
export function parseWingsAuthorization(header: string | null | undefined): WingsToken | null {
  if (!header) return null;

  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;

  const separator = value.indexOf(WINGS_TOKEN_SEPARATOR);
  if (separator <= 0 || separator === value.length - 1) return null;

  return { id: value.slice(0, separator), secret: value.slice(separator + 1) };
}

/* -------------------------------------------------------------------------- */
/* Routes appelées par Wings sur le panel                                      */
/* -------------------------------------------------------------------------- */

/**
 * Relevé exhaustif des appels du daemon, chemins relatifs au préfixe.
 *
 * Trois d'entre eux sont faciles à oublier en travaillant de mémoire, et leur
 * absence ne se voit qu'à l'usage : `POST /servers/reset` au démarrage du
 * daemon, `POST /activity` qui remonte le journal des actions SFTP et console,
 * et les sauvegardes qui vivent sous `/backups/{uuid}` et non sous le serveur.
 */
export const WINGS_REMOTE_ROUTES = [
  { method: "GET", path: "/servers", purpose: "Inventaire paginé des serveurs du node" },
  { method: "POST", path: "/servers/reset", purpose: "Remise à zéro des états au démarrage" },
  { method: "GET", path: "/servers/{uuid}", purpose: "Configuration complète d'un serveur" },
  { method: "GET", path: "/servers/{uuid}/install", purpose: "Script d'installation" },
  { method: "POST", path: "/servers/{uuid}/install", purpose: "Compte rendu d'installation" },
  { method: "POST", path: "/servers/{uuid}/archive", purpose: "Résultat d'archivage (transfert)" },
  { method: "POST", path: "/servers/{uuid}/transfer/{state}", purpose: "Progression du transfert" },
  { method: "POST", path: "/sftp/auth", purpose: "Authentification SFTP" },
  { method: "GET", path: "/backups/{uuid}", purpose: "Jetons d'envoi vers S3 (paramètre size)" },
  { method: "POST", path: "/backups/{uuid}", purpose: "Compte rendu de sauvegarde" },
  { method: "POST", path: "/backups/{uuid}/restore", purpose: "Compte rendu de restauration" },
  { method: "POST", path: "/activity", purpose: "Journal d'activité remonté par le daemon" },
] as const;

/* -------------------------------------------------------------------------- */
/* Formes des charges utiles                                                   */
/* -------------------------------------------------------------------------- */

/** Pagination Laravel : c'est la forme qu'attend `getServersPaged`. */
export const WingsPagination = z.object({
  current_page: z.number().int().nonnegative(),
  from: z.number().int().nonnegative(),
  last_page: z.number().int().nonnegative(),
  per_page: z.number().int().positive(),
  to: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type WingsPagination = z.infer<typeof WingsPagination>;

/**
 * Un serveur dans l'inventaire.
 *
 * `settings` et `process_configuration` sont opaques pour Wings, qui les
 * transmet tels quels à ses sous-systèmes. Les valider finement ici serait
 * inutile ; ce qui compte est de les restituer sans perte, d'où leur stockage
 * en jsonb (§6.3).
 */
export const WingsRawServer = z.object({
  uuid: z.string().uuid(),
  settings: z.unknown(),
  process_configuration: z.unknown(),
});
export type WingsRawServer = z.infer<typeof WingsRawServer>;

export const WingsServerListResponse = z.object({
  data: z.array(WingsRawServer),
  meta: WingsPagination,
});
export type WingsServerListResponse = z.infer<typeof WingsServerListResponse>;

export const WingsInstallationScript = z.object({
  container_image: z.string().min(1),
  entrypoint: z.string().min(1),
  script: z.string(),
});
export type WingsInstallationScript = z.infer<typeof WingsInstallationScript>;

export const WingsInstallStatus = z.object({
  successful: z.boolean(),
  reinstall: z.boolean(),
});
export type WingsInstallStatus = z.infer<typeof WingsInstallStatus>;

/** Deux modes seulement : mot de passe ou clé publique. */
export const SftpAuthType = z.enum(["password", "public_key"]);
export type SftpAuthType = z.infer<typeof SftpAuthType>;

export const SftpAuthRequest = z.object({
  type: SftpAuthType,
  username: z.string().min(1),
  /** Mot de passe, ou clé publique au format `authorized_keys` selon `type`. */
  password: z.string(),
  ip: z.string(),
  session_id: z.string().nullable().optional(),
  client_version: z.string().nullable().optional(),
});
export type SftpAuthRequest = z.infer<typeof SftpAuthRequest>;

export const SftpAuthResponse = z.object({
  /** UUID du serveur auquel la connexion donne accès. */
  server: z.string().uuid(),
  user: z.string(),
  /** Mêmes chaînes que les permissions de sous-utilisateur (§5.2). */
  permissions: z.array(z.string()),
});
export type SftpAuthResponse = z.infer<typeof SftpAuthResponse>;

export const WingsBackupPart = z.object({
  etag: z.string(),
  part_number: z.number().int().positive(),
});

export const WingsBackupReport = z.object({
  checksum: z.string(),
  checksum_type: z.string(),
  size: z.number().int().nonnegative(),
  successful: z.boolean(),
  /**
   * Les morceaux d'un envoi multipart — **`null` quand il n'y en a pas**.
   *
   * Le daemon ne remplit ce champ que pour un dépôt sur compartiment. Pour une
   * sauvegarde sur le disque du node, il laisse sa tranche à zéro, et Go
   * sérialise une tranche nil en `null`, jamais en `[]`.
   *
   * Exiger un tableau faisait donc **refuser le compte rendu de toute
   * sauvegarde locale**. Relevé en faisant tourner un vrai daemon : il
   * fabriquait l'archive, puis se voyait répondre « Compte rendu de sauvegarde
   * invalide ». La sauvegarde restait « en cours » pour toujours — elle
   * consommait le quota, ne se téléchargeait pas, ne se restaurait pas et ne
   * se supprimait pas. Le genre de panne qu'on découvre le jour où l'on a
   * besoin de sa sauvegarde.
   *
   * On rend donc un tableau dans tous les cas : le service en aval écrivait
   * déjà `report.parts ?? []`, il n'avait jamais l'occasion de s'en servir.
   */
  parts: z
    .array(WingsBackupPart)
    .nullish()
    .transform((parts) => parts ?? []),
});
export type WingsBackupReport = z.infer<typeof WingsBackupReport>;

/** Format d'erreur attendu par `AsRequestError`. */
export const WingsErrorResponse = z.object({
  errors: z.array(
    z.object({
      code: z.string(),
      status: z.string(),
      detail: z.string(),
    }),
  ),
});
export type WingsErrorResponse = z.infer<typeof WingsErrorResponse>;

/* -------------------------------------------------------------------------- */
/* Comportements imposés                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Wings ne réessaie **pas** sur un code 4xx, et réessaie avec temporisation
 * exponentielle sur tout le reste.
 *
 * Conséquence pratique, et piège à éviter : répondre 500 à une requête qui
 * n'aboutira jamais — un serveur supprimé, par exemple — déclenche une boucle
 * de tentatives. Une condition définitive doit donc sortir en 4xx.
 */
export function wingsWillRetry(status: number): boolean {
  return status < 400 || status >= 500;
}

/**
 * Réponse à donner quand des identifiants SFTP sont refusés.
 *
 * N'importe quel 4xx convient : Wings les traite tous comme « identifiants
 * invalides » et n'insiste pas. Le 403 est plus juste qu'un 401, qui inviterait
 * à présenter d'autres identifiants alors que ceux du daemon sont valides — ce
 * sont ceux de l'utilisateur final qui ne le sont pas.
 */
export const SFTP_INVALID_CREDENTIALS_STATUS = 403;

/**
 * Décrit si une réponse est un succès du point de vue de Wings.
 *
 * Le daemon considère en échec tout ce qui sort de la plage 2xx, redirections
 * comprises : une 302 vers une page de connexion, par exemple lorsqu'un
 * intergiciel d'authentification s'applique par erreur aux routes `remote`,
 * est traitée comme une panne et non comme une redirection à suivre.
 */
export function wingsAcceptsStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
