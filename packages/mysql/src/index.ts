import mysql from "mysql2/promise";

/**
 * Coordonnées d'un hôte MySQL administré par le panel.
 *
 * Le mot de passe est reçu **en clair** : ce paquet ne connaît pas le coffre
 * du panel, et le déchiffrement appartient à l'appelant. C'est volontaire —
 * confier la clé de chiffrement à un module dont le rôle est de concaténer des
 * requêtes SQL élargirait inutilement ce qu'une faille ici permettrait.
 */
export interface MysqlHost {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

/** Levée quand l'hôte ne répond pas, par opposition à une requête refusée. */
export class MysqlHostUnreachableError extends Error {
  constructor(
    readonly hostName: string,
    cause: string,
  ) {
    super(`L'hôte de bases « ${hostName} » est injoignable : ${cause}`);
    this.name = "MysqlHostUnreachableError";
  }
}

/** Levée quand un nom fourni ne peut pas entrer dans une requête sans danger. */
export class MysqlIdentifierError extends Error {
  constructor(label: string) {
    super(`${label} invalide : lettres, chiffres et « _ » uniquement.`);
    this.name = "MysqlIdentifierError";
  }
}

/**
 * Nom d'objet MySQL acceptable.
 *
 * Voir le README : ni guillemet, ni espace, ni point, ni caractère de contrôle.
 * 48 caractères au plus, ce qui laisse la place au préfixe de serveur sans
 * dépasser la limite de 64 de MySQL.
 */
const SAFE_IDENTIFIER = /^[a-zA-Z0-9_]{1,48}$/;

/**
 * Adresse depuis laquelle l'utilisateur est autorisé à se connecter.
 *
 * `%` est admis parce que c'est le cas réel — un serveur de jeu conteneurisé
 * change d'adresse à chaque démarrage. Tout le reste est contraint : cette
 * valeur est injectée dans la clause `@'…'` exactement comme le nom l'est
 * ailleurs.
 */
const SAFE_REMOTE = /^[a-zA-Z0-9_.:%-]{1,60}$/;

/**
 * Éprouve les identifiants d'un hôte.
 *
 * Déclarer un hôte avec un mot de passe faux ne casse rien tout de suite : la
 * panne n'apparaît qu'à la première création de base, chez un client qui n'y
 * est pour rien. Cette vérification déplace la découverte au moment où l'on
 * saisit les identifiants, là où l'on peut encore les corriger.
 *
 * Le **privilège** est éprouvé en plus de la connexion : un compte qui se
 * connecte mais ne peut pas créer d'utilisateur passerait le premier contrôle
 * et échouerait au premier usage réel.
 */
export async function probeHost(host: MysqlHost): Promise<{ version: string; canCreate: boolean }> {
  return withConnection(host, async (connection) => {
    const [rows] = await connection.query("select version() as version");
    const version = String((rows as { version?: unknown }[])[0]?.version ?? "inconnue");

    const [grants] = await connection.query("show grants for current_user()");
    const text = (grants as Record<string, string>[])
      .map((row) => Object.values(row).join(" "))
      .join(" ")
      .toUpperCase();

    // « ALL PRIVILEGES ON *.* » ou « CREATE USER » : les deux formes que prend
    // un compte d'administration selon la façon dont il a été créé.
    const canCreate = text.includes("ALL PRIVILEGES ON *.*") || text.includes("CREATE USER");
    return { version, canCreate };
  });
}

/**
 * Plafond de connexions simultanées accordé à un utilisateur de base.
 *
 * **Un hôte MySQL est partagé entre des clients qui ne se connaissent pas.**
 * Sans plafond, un seul plugin mal écrit — ou une seule fuite de connexions —
 * épuise le `max_connections` du serveur, et **tous** les autres clients
 * perdent leur base en même temps. Le panel ne saurait alors même pas dire
 * lequel est en cause.
 *
 * Vingt : très au-dessus de ce qu'un serveur de jeu emploie — un pool typique
 * en ouvre deux à cinq — et très en dessous du plafond d'un hôte MySQL, qui
 * vaut cent cinquante par défaut. Le but est d'arrêter l'emballement, pas de
 * gêner l'usage normal.
 */
export const DEFAULT_MAX_USER_CONNECTIONS = 20;

/**
 * Crée la base et son utilisateur dédié.
 *
 * Les droits sont accordés sur cette base seulement (`GRANT ALL ON db.*`), et
 * jamais sur `*.*` : un client compromis reste enfermé dans sa base.
 *
 * L'utilisateur reçoit un **plafond de connexions**, pour la raison dite au
 * dessus de `DEFAULT_MAX_USER_CONNECTIONS` : sur un hôte partagé, un voisin qui
 * s'emballe ne doit pas emporter les autres avec lui.
 */
export async function createDatabase(
  host: MysqlHost,
  database: string,
  username: string,
  password: string,
  remote: string,
  maxConnections: number = DEFAULT_MAX_USER_CONNECTIONS,
): Promise<void> {
  assertIdentifier(database, "Nom de base");
  assertIdentifier(username, "Nom d'utilisateur");
  assertRemote(remote);

  await withConnection(host, async (connection) => {
    const db = mysql.escapeId(database);
    const user = quotedUser(username, remote);

    await connection.query(`CREATE DATABASE ${db}`);
    try {
      // Le plafond est posé à la création, dans la même instruction : en deux
      // temps, un échec du second laisserait un utilisateur sans limite, donc
      // exactement le cas qu'on veut éviter.
      await connection.query(
        `CREATE USER ${user} IDENTIFIED BY ${mysql.escape(password)} ` +
          `WITH MAX_USER_CONNECTIONS ${Math.max(1, Math.trunc(maxConnections))}`,
      );
      await connection.query(`GRANT ALL PRIVILEGES ON ${db}.* TO ${user}`);
    } catch (error) {
      // La base existe mais pas son utilisateur : la laisser derrière
      // bloquerait toute nouvelle tentative sous le même nom, avec un « cette
      // base existe déjà » que rien n'expliquerait côté client.
      await connection.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Change le mot de passe d'un utilisateur.
 *
 * `ALTER USER` et non « supprimer puis recréer » : recréer perdrait les droits
 * accordés, et laisserait la base inaccessible si l'opération s'interrompait
 * entre les deux.
 */
export async function rotatePassword(
  host: MysqlHost,
  username: string,
  remote: string,
  password: string,
): Promise<void> {
  assertIdentifier(username, "Nom d'utilisateur");
  assertRemote(remote);

  await withConnection(host, async (connection) => {
    await connection.query(
      `ALTER USER ${quotedUser(username, remote)} IDENTIFIED BY ${mysql.escape(password)}`,
    );
  });
}

/**
 * Supprime la base et son utilisateur.
 *
 * `IF EXISTS` sur les deux : le ménage doit aboutir même si l'un des objets a
 * déjà disparu, sinon une ligne resterait à jamais dans le panel, impossible à
 * effacer parce que la suppression échoue à mi-parcours.
 */
export async function dropDatabase(
  host: MysqlHost,
  database: string,
  username: string,
  remote: string,
): Promise<void> {
  assertIdentifier(database, "Nom de base");
  assertIdentifier(username, "Nom d'utilisateur");
  assertRemote(remote);

  await withConnection(host, async (connection) => {
    await connection.query(`DROP USER IF EXISTS ${quotedUser(username, remote)}`);
    await connection.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(database)}`);
  });
}

/** `'utilisateur'@'adresse'`, les deux moitiés échappées. */
function quotedUser(username: string, remote: string): string {
  return `${mysql.escape(username)}@${mysql.escape(remote)}`;
}

export function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}

function assertIdentifier(value: string, label: string): void {
  if (!SAFE_IDENTIFIER.test(value)) throw new MysqlIdentifierError(label);
}

function assertRemote(remote: string): void {
  if (!SAFE_REMOTE.test(remote)) throw new MysqlIdentifierError("Adresse de connexion");
}

/**
 * Ouvre une connexion administrateur, exécute, referme dans tous les cas.
 *
 * Pas de pool : ces opérations sont rares et brèves, et un pool garderait des
 * connexions administrateur ouvertes en permanence vers chaque hôte déclaré —
 * une surface bien plus large pour un gain nul.
 */
async function withConnection<T>(
  host: MysqlHost,
  work: (connection: mysql.Connection) => Promise<T>,
): Promise<T> {
  let connection: mysql.Connection;
  try {
    connection = await mysql.createConnection({
      host: host.host,
      port: host.port,
      user: host.username,
      password: host.password,
      connectTimeout: 8000,
      // Une seule requête par appel. Cette option permettrait d'en enchaîner
      // plusieurs séparées par un point-virgule, et transformerait la moindre
      // faiblesse d'échappement en exécution arbitraire.
      multipleStatements: false,
      // `MYSQL_TLS=require` : la connexion administrateur porte le mot de
      // passe root et chaque `IDENTIFIED BY` en clair ; dès que l'hôte n'est
      // pas la machine locale, elle doit être chiffrée et le certificat vérifié.
      ...(process.env.MYSQL_TLS === "require" ? { ssl: { rejectUnauthorized: true } } : {}),
    });
  } catch (cause) {
    throw new MysqlHostUnreachableError(
      host.name,
      cause instanceof Error ? cause.message : "erreur inconnue",
    );
  }

  try {
    return await work(connection);
  } finally {
    await connection.end().catch(() => undefined);
  }
}
