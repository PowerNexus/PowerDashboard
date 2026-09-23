import { createHmac, randomUUID } from "node:crypto";
import { decryptSecret } from "@gamedashboard/auth";
import { type Database, nodes, servers } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Traduit nos permissions dans celles que Wings vérifie sur le websocket
 * (`router/websocket/websocket.go`) : `websocket.connect` pour ouvrir,
 * `control.console` pour envoyer, `control.start|stop|restart` pour
 * l'alimentation, `backup.read` pour suivre une sauvegarde.
 *
 * Sans cette traduction, un jeton de sous-utilisateur portait `console.read`,
 * que Wings ne connaît pas : il refusait la connexion. Fermé par défaut, mais
 * faux — et la correction tentante, `*` pour tout le monde, aurait été une
 * escalade. `*` reste réservé au propriétaire et au personnel : Wings en
 * exclut lui-même les droits `admin.*`.
 */
export function toWingsWebsocketPermissions(granted: readonly string[]): string[] {
  if (granted.includes("*")) return ["*"];

  const wings = new Set<string>();
  if (granted.includes("console.read")) wings.add("websocket.connect");
  if (granted.includes("console.send")) wings.add("control.console");
  if (granted.includes("power.start")) wings.add("control.start");
  // `kill` est un arrêt forcé : Wings ne distingue pas, c'est `control.stop`.
  if (granted.includes("power.stop") || granted.includes("power.kill")) wings.add("control.stop");
  if (granted.includes("power.restart")) wings.add("control.restart");
  if (granted.includes("backups.read")) wings.add("backup.read");
  return [...wings];
}

/**
 * Jetons éphémères présentés par le navigateur au daemon.
 *
 * Le navigateur ouvre le websocket **directement** vers Wings, sans passer par
 * le panel : relayer un flux de console à raison d'une ligne par milliseconde
 * pour chaque serveur ouvert ferait du panel un goulot d'étranglement, et le
 * rendrait responsable d'une panne qui n'est pas la sienne.
 *
 * Il faut donc lui remettre une autorisation qu'il puisse présenter lui-même.
 * C'est un JWT signé HMAC-SHA256 avec le jeton du node — relevé dans
 * `config.GetJwtAlgorithm()` de la source du daemon, où la clé est la valeur
 * de `token`.
 *
 * Trois propriétés rendent ce jeton acceptable entre des mains non fiables :
 * il ne vaut que pour un serveur, il ne porte que les permissions de son
 * porteur, et il expire vite.
 */

/** Court : le jeton transite par le navigateur et n'est utilisé qu'à l'ouverture. */
export const WEBSOCKET_TOKEN_TTL_SECONDS = 600;

/**
 * Durée de vie du jeton de transfert.
 *
 * Une heure, et non dix minutes comme pour la console : le jeton doit rester
 * valable pendant **tout** le transfert, archive comprise. Un serveur de
 * plusieurs gigaoctets sur une liaison ordinaire dépasse largement le quart
 * d'heure, et un jeton expiré en cours de route ferait échouer un transfert
 * aux trois quarts terminé.
 */
export const TRANSFER_TOKEN_TTL_SECONDS = 3600;

/** Où déposer l'archive, et avec quelle autorisation. */
export interface TransferGrant {
  token: string;
  url: string;
}

export interface WebsocketGrant {
  token: string;
  /** Adresse complète du websocket, construite depuis la base. */
  socket: string;
}

interface IssuedToken {
  jti: string;
  serverId: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class WingsTokenService {
  /**
   * Jetons émis et non encore expirés.
   *
   * En mémoire, et assumé comme tel. Wings révoque par `jti` : sans mémoire de
   * ce que nous avons signé, un accès retiré resterait actif jusqu'à
   * l'expiration du jeton. La liste est bornée par la durée de vie — dix
   * minutes — et se purge à chaque émission.
   *
   * Limite à connaître : un redémarrage du panel vide cette liste, et les
   * jetons en circulation deviennent irrévocables. Ils expirent d'eux-mêmes
   * dans les dix minutes, ce qui rend la fenêtre acceptable ; une table en base
   * la fermerait complètement, au prix d'une écriture à chaque ouverture de
   * console. Le jour où ce compromis ne convient plus, c'est ici qu'il se
   * change, et nulle part ailleurs.
   */
  private readonly issued: IssuedToken[] = [];

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Jetons à révoquer pour un utilisateur sur un serveur.
   *
   * Les retire de la liste au passage : une révocation ne se rejoue pas, et
   * les garder ferait grossir la liste sans fin.
   */
  /** Tous les jetons vivants d'un serveur, quel qu'en soit le porteur. */
  revocableForServer(serverId: string): string[] {
    this.purge();
    const matching: string[] = [];
    for (let i = this.issued.length - 1; i >= 0; i--) {
      const token = this.issued[i];
      if (token && token.serverId === serverId) {
        matching.push(token.jti);
        this.issued.splice(i, 1);
      }
    }
    return matching;
  }

  revocableFor(serverId: string, userId: string): string[] {
    this.purge();
    const matching: string[] = [];
    for (let i = this.issued.length - 1; i >= 0; i--) {
      const token = this.issued[i];
      if (token && token.serverId === serverId && token.userId === userId) {
        matching.push(token.jti);
        this.issued.splice(i, 1);
      }
    }
    return matching;
  }

  /**
   * Tous les jetons vivants d'un porteur, rangés par serveur.
   *
   * Sert à la suspension d'un compte : ses sessions tombent, mais une console
   * déjà ouverte vit sur un jeton de dix minutes que Wings ne revérifie pas. Le
   * rangement par serveur suit la route de Wings, qui révoque serveur par
   * serveur.
   */
  revocableForUser(userId: string): Map<string, string[]> {
    this.purge();
    const byServer = new Map<string, string[]>();
    for (let i = this.issued.length - 1; i >= 0; i--) {
      const token = this.issued[i];
      if (token && token.userId === userId) {
        byServer.set(token.serverId, [...(byServer.get(token.serverId) ?? []), token.jti]);
        this.issued.splice(i, 1);
      }
    }
    return byServer;
  }

  private purge(): void {
    const now = Math.floor(Date.now() / 1000);
    for (let i = this.issued.length - 1; i >= 0; i--) {
      if ((this.issued[i]?.expiresAt ?? 0) <= now) this.issued.splice(i, 1);
    }
  }

  async websocketGrant(
    serverId: string,
    userId: string,
    permissions: readonly string[],
  ): Promise<WebsocketGrant> {
    const [row] = await this.db
      .select({
        scheme: nodes.scheme,
        fqdn: nodes.fqdn,
        port: nodes.daemonPort,
        token: nodes.daemonTokenEnc,
      })
      .from(servers)
      .innerJoin(nodes, eq(servers.nodeId, nodes.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) throw new Error("Serveur introuvable.");

    const now = Math.floor(Date.now() / 1000);
    const jti = randomUUID();
    const expiresAt = now + WEBSOCKET_TOKEN_TTL_SECONDS;

    this.purge();
    this.issued.push({ jti, serverId, userId, expiresAt });

    const payload = {
      // `jti` et `iat` servent la liste de révocation du daemon : après un
      // `POST /ws/deny`, Wings refuse les jetons émis avant cet instant.
      jti,
      iat: now,
      nbf: now,
      exp: expiresAt,
      scope: "websocket",
      user_uuid: userId,
      server_uuid: serverId,
      // Les permissions voyagent dans le jeton signé, pas dans un paramètre :
      // le navigateur ne peut donc pas s'en attribuer d'autres. Elles sont
      // traduites dans le vocabulaire du daemon, qui ne connaît pas le nôtre.
      permissions: toWingsWebsocketPermissions(permissions),
    };

    return {
      token: signHs256(payload, decryptSecret(row.token)),
      socket: `${row.scheme === "https" ? "wss" : "ws"}://${row.fqdn}:${row.port}/api/servers/${serverId}/ws`,
    };
  }

  /**
   * Autorisation de télécharger une sauvegarde restée sur le disque du node.
   *
   * Le navigateur tire l'archive **directement** du daemon, comme il ouvre le
   * websocket : plusieurs gigaoctets relayés par le panel en feraient un goulot
   * d'étranglement pour un fichier qu'il n'a aucune raison de lire.
   *
   * Le jeton ne vaut **qu'une fois** — Wings retient son `unique_id` et refuse
   * de le resservir. C'est ce qui rend acceptable une adresse qui circule en
   * clair dans la barre du navigateur : recopiée, elle ne rouvrira rien.
   */
  async backupDownloadGrant(serverId: string, backupId: string, userId: string): Promise<string> {
    const [row] = await this.db
      .select({
        scheme: nodes.scheme,
        fqdn: nodes.fqdn,
        port: nodes.daemonPort,
        token: nodes.daemonTokenEnc,
      })
      .from(servers)
      .innerJoin(nodes, eq(servers.nodeId, nodes.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) throw new Error("Serveur introuvable.");

    const now = Math.floor(Date.now() / 1000);
    const token = signHs256(
      {
        iat: now,
        nbf: now,
        // Court : le temps de suivre une redirection, pas celui de faire
        // circuler l'adresse. Le téléchargement lui-même peut durer, il a
        // commencé avant l'expiration.
        exp: now + 60,
        jti: randomUUID(),
        unique_id: randomUUID(),
        scope: "backup-download",
        server_uuid: serverId,
        backup_uuid: backupId,
        user_uuid: userId,
      },
      decryptSecret(row.token),
    );

    return `${row.scheme}://${row.fqdn}:${row.port}/download/backup?token=${encodeURIComponent(token)}`;
  }

  /**
   * Autorisation de tirer **un** fichier du volume d'un serveur.
   *
   * Le chemin est **scellé dans le jeton**, et c'est toute la différence avec
   * l'envoi : là, le dossier de destination voyage en clair dans la requête, et
   * Wings le confine au volume. Ici, un chemin libre laisserait le porteur du
   * jeton demander n'importe quel fichier du serveur — ses variables d'egg,
   * donc ses mots de passe RCON. Le panel décide donc du fichier, le signe,
   * et le daemon ne sert que celui-là.
   *
   * À usage unique, comme la sauvegarde : l'adresse passe par la barre du
   * navigateur, et recopiée elle ne servira plus rien.
   */
  async fileDownloadGrant(serverId: string, userId: string, filePath: string): Promise<string> {
    const [row] = await this.db
      .select({
        scheme: nodes.scheme,
        fqdn: nodes.fqdn,
        port: nodes.daemonPort,
        token: nodes.daemonTokenEnc,
      })
      .from(servers)
      .innerJoin(nodes, eq(servers.nodeId, nodes.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) throw new Error("Serveur introuvable.");

    const now = Math.floor(Date.now() / 1000);
    const token = signHs256(
      {
        iat: now,
        nbf: now,
        // Une minute : le temps de suivre la redirection, pas celui de faire
        // circuler l'adresse. Le transfert lui-même a commencé avant.
        exp: now + 60,
        jti: randomUUID(),
        unique_id: randomUUID(),
        scope: "file-download",
        server_uuid: serverId,
        user_uuid: userId,
        file_path: filePath,
      },
      decryptSecret(row.token),
    );

    return `${row.scheme}://${row.fqdn}:${row.port}/download/file?token=${encodeURIComponent(token)}`;
  }

  /**
   * Autorisation d'envoyer des fichiers dans le volume d'un serveur.
   *
   * Le navigateur dépose **directement** chez le daemon, comme il tire les
   * sauvegardes : un modpack de plusieurs centaines de mégaoctets traverserait
   * sinon le panel deux fois, et le tiendrait occupé pendant tout l'envoi pour
   * un fichier qu'il n'a aucune raison de lire.
   *
   * Le jeton ne vaut **qu'une fois** : Wings retient son `unique_id` et refuse
   * de le resservir. Recopiée, l'adresse ne redéposera rien — ce qui compte,
   * puisqu'elle circule en clair dans une requête du navigateur.
   *
   * Le dossier de destination n'est **pas** dans le jeton : Wings le lit dans
   * la requête, et le confine de toute façon au volume du serveur (§4.3). L'y
   * mettre donnerait l'illusion que le panel garde la porte, alors qu'elle est
   * gardée chez le daemon.
   */
  async uploadGrant(serverId: string, userId: string): Promise<{ token: string; url: string }> {
    const [row] = await this.db
      .select({
        scheme: nodes.scheme,
        fqdn: nodes.fqdn,
        port: nodes.daemonPort,
        token: nodes.daemonTokenEnc,
      })
      .from(servers)
      .innerJoin(nodes, eq(servers.nodeId, nodes.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) throw new Error("Serveur introuvable.");

    const now = Math.floor(Date.now() / 1000);
    const token = signHs256(
      {
        iat: now,
        nbf: now,
        /*
         * Quinze minutes, et non une comme pour le téléchargement.
         *
         * C'est le délai pour **commencer** l'envoi, pas pour le finir : une
         * fois la requête acceptée, elle dure ce qu'elle dure. Mais on choisit
         * ici un fichier dans une fenêtre du système, et cela prend parfois
         * plus d'une minute.
         */
        exp: now + 900,
        jti: randomUUID(),
        unique_id: randomUUID(),
        // Nom de portée relevé dans la source du daemon : `file-upload`.
        // `Scoped.Scope` y est une chaîne séparée par des espaces, et une
        // portée inconnue fait répondre 404 sans plus d'explication.
        scope: "file-upload",
        server_uuid: serverId,
        user_uuid: userId,
      },
      decryptSecret(row.token),
    );

    return { token, url: `${row.scheme}://${row.fqdn}:${row.port}/upload/file` };
  }

  /**
   * Autorisation de dépôt sur le node **d'arrivée**.
   *
   * Un transfert met deux daemons en relation directe : le node de départ
   * fabrique l'archive du serveur et la pousse vers celui d'arrivée, sans que
   * l'archive passe par le panel — plusieurs gigaoctets qui n'ont rien à faire
   * ici, et une panne du panel en plein transfert n'interromprait rien.
   *
   * Il faut donc que le node de départ puisse prouver au node d'arrivée qu'il
   * a le droit de déposer. Le jeton est signé avec la clé de **l'arrivée**,
   * parce que c'est elle qui le vérifiera ; signé avec celle du départ, il
   * serait rejeté sans que rien ne dise pourquoi.
   *
   * Sa portée est aussi étroite que possible : un seul serveur, une seule
   * action, et une heure de validité. Il transite par le node de départ, qui
   * est une machine que le panel gouverne mais n'héberge pas.
   */
  async transferGrant(serverId: string, toNodeId: string): Promise<TransferGrant> {
    const [target] = await this.db
      .select({
        scheme: nodes.scheme,
        fqdn: nodes.fqdn,
        port: nodes.daemonPort,
        token: nodes.daemonTokenEnc,
      })
      .from(nodes)
      .where(eq(nodes.id, toNodeId))
      .limit(1);

    if (!target) throw new Error("Node de destination introuvable.");

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now,
      nbf: now,
      exp: now + TRANSFER_TOKEN_TTL_SECONDS,
      // `sub` porte le serveur : Wings s'en sert pour savoir quel serveur il
      // reçoit, et refuse un dépôt qui ne correspond pas.
      sub: serverId,
      // Nom de portée relevé dans la source du daemon : « transfer », et non
      // « server-transfer ». Une portée inconnue fait répondre 403 sans plus
      // d'explication.
      scope: "transfer",
    };

    return {
      /*
       * **Le préfixe `Bearer ` fait partie du jeton, et ce n'est pas un choix.**
       *
       * Le daemon de départ pose cet en-tête **verbatim** — `req.Header.Set(
       * "Authorization", token)` dans `server/transfer/source.go` — sans rien
       * y ajouter. Celui d'arrivée, lui, découpe l'en-tête sur l'espace et
       * exige `Bearer` en premier morceau, sinon il répond 401.
       *
       * Un jeton nu faisait donc **échouer tout transfert**, et de la pire
       * façon : le panel marquait le serveur « en transfert », le daemon
       * archivait le volume, se faisait refuser au dépôt, et l'on revenait en
       * arrière. Rien dans le panel ne disait pourquoi — le refus n'existait
       * que dans le journal du node de départ.
       *
       * Relevé en faisant tourner deux daemons côte à côte. Aucun test unitaire
       * ne pouvait le voir : la divergence est entre ce que le panel remet et
       * ce que deux programmes distincts en font.
       */
      token: `Bearer ${signHs256(payload, decryptSecret(target.token))}`,
      url: `${target.scheme}://${target.fqdn}:${target.port}/api/transfers`,
    };
  }
}

/**
 * Forge un JWT HS256.
 *
 * Écrit à la main plutôt qu'avec une bibliothèque : un JWT signé est trois
 * segments base64url et un HMAC, et l'opération tient en dix lignes. Ajouter
 * une dépendance pour cela élargirait la surface d'attaque de la chaîne
 * d'approvisionnement sans rien simplifier — et les bibliothèques JWT ont un
 * historique de failles nourri, presque toujours du côté de la *vérification*,
 * que nous ne faisons pas ici.
 */
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
