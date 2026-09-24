import { createHmac, randomBytes } from "node:crypto";
import type { Database } from "@gamedashboard/db";
import { describe, expect, it } from "vitest";
import { encryptRowSecret } from "../../common/row-secrets";
import { WingsTokenService } from "./wings-token.service";

const SERVER = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

/** Le registre de jetons ne touche pas la base : un double vide suffit. */
function service() {
  return new WingsTokenService({} as unknown as Database);
}

type Registry = {
  issued: { jti: string; serverId: string; userId: string; expiresAt: number }[];
};

function register(svc: WingsTokenService, entry: Registry["issued"][number]) {
  (svc as unknown as Registry).issued.push(entry);
}

const future = () => Math.floor(Date.now() / 1000) + 600;

describe("révocation des jetons de console", () => {
  it("rend les jetons d'un utilisateur sur un serveur", () => {
    const svc = service();
    register(svc, { jti: "a", serverId: SERVER, userId: USER, expiresAt: future() });
    register(svc, { jti: "b", serverId: SERVER, userId: USER, expiresAt: future() });

    expect(svc.revocableFor(SERVER, USER).sort()).toEqual(["a", "b"]);
  });

  it("ne rend pas ceux d'un autre utilisateur", () => {
    // Révoquer trop large déconnecterait le propriétaire en retirant l'accès
    // d'un tiers — une panne apparente causée par une opération réussie.
    const svc = service();
    register(svc, { jti: "a", serverId: SERVER, userId: USER, expiresAt: future() });
    register(svc, { jti: "b", serverId: SERVER, userId: "autre", expiresAt: future() });

    expect(svc.revocableFor(SERVER, USER)).toEqual(["a"]);
  });

  it("ne rend pas ceux d'un autre serveur", () => {
    const svc = service();
    register(svc, { jti: "a", serverId: "autre", userId: USER, expiresAt: future() });

    expect(svc.revocableFor(SERVER, USER)).toEqual([]);
  });

  it("ne rend pas deux fois le même jeton", () => {
    // Une révocation ne se rejoue pas, et conserver les entrées ferait grossir
    // la liste sans fin.
    const svc = service();
    register(svc, { jti: "a", serverId: SERVER, userId: USER, expiresAt: future() });

    expect(svc.revocableFor(SERVER, USER)).toEqual(["a"]);
    expect(svc.revocableFor(SERVER, USER)).toEqual([]);
  });

  it("oublie les jetons expirés", () => {
    const svc = service();
    register(svc, {
      jti: "vieux",
      serverId: SERVER,
      userId: USER,
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    });

    // Inutile de demander au daemon de refuser un jeton qu'il refuse déjà.
    expect(svc.revocableFor(SERVER, USER)).toEqual([]);
  });
});

describe("révocation des consoles d'un compte suspendu", () => {
  it("rend tous les jetons du compte, rangés par serveur", () => {
    // La suspension ferme les consoles déjà ouvertes : un jeton vit dix
    // minutes et Wings ne revérifie pas le compte en cours de route.
    const svc = service();
    register(svc, { jti: "a", serverId: SERVER, userId: USER, expiresAt: future() });
    register(svc, { jti: "b", serverId: "autre", userId: USER, expiresAt: future() });
    register(svc, { jti: "c", serverId: SERVER, userId: "autre", expiresAt: future() });

    const byServer = svc.revocableForUser(USER);
    expect(Object.fromEntries(byServer)).toEqual({ [SERVER]: ["a"], autre: ["b"] });
    // Le jeton d'un autre compte reste : suspendre l'un ne coupe pas l'autre.
    expect(svc.revocableFor(SERVER, "autre")).toEqual(["c"]);
    expect(svc.revocableForUser(USER).size).toBe(0);
  });
});

/**
 * Le jeton de console ne sert qu'à **lire**.
 *
 * Il scellait `control.console` et `control.*` pour qui avait `console.send`
 * ou `power.*` — et `*` pour le propriétaire, qui les contient. Une porte
 * parallèle : commandes et alimentation envoyées sur la socket passaient à
 * côté de `requireOperable` (serveur suspendu, en installation, en transfert)
 * et du journal du panel. L'interface et le SDK passent déjà tout par l'API ;
 * la socket ne leur sert qu'à recevoir.
 */
describe("permissions du jeton de console", () => {
  const SECRET = "jeton-du-node";

  /** Un double de base qui rend le node du serveur, quelle que soit la requête. */
  function dbAvecNode(): Database {
    const chaine: Record<string, unknown> = {};
    chaine.select = () => chaine;
    chaine.from = () => chaine;
    chaine.innerJoin = () => chaine;
    chaine.where = () => chaine;
    chaine.limit = async () => [
      {
        scheme: "https",
        fqdn: "node.exemple.fr",
        port: 8080,
        nodeId: "55555555-5555-5555-5555-555555555555",
        token: encryptRowSecret(
          "nodes.daemon_token_enc",
          "55555555-5555-5555-5555-555555555555",
          SECRET,
        ),
      },
    ];
    return chaine as unknown as Database;
  }

  async function scelle(accordees: string[]): Promise<string[]> {
    process.env.APP_SECRET_KEY ??= randomBytes(32).toString("base64");
    const grant = await new WingsTokenService(dbAvecNode()).websocketGrant(SERVER, USER, accordees);
    const [, corps] = grant.token.split(".");
    return JSON.parse(Buffer.from(corps ?? "", "base64url").toString("utf8")).permissions;
  }

  it("ne scelle jamais d'ordre, même pour le propriétaire", async () => {
    const permissions = await scelle(["*", "admin.websocket.install"]);
    expect(permissions).not.toContain("*");
    expect(permissions.filter((p) => p.startsWith("control."))).toEqual([]);
  });

  it("garde au propriétaire tout ce qui se lit : flux, sauvegardes, installation", async () => {
    // Wings envoie console, statistiques et état à tout jeton connecté ; il ne
    // filtre que la sortie d'installation (`admin.websocket.install`, que son
    // joker exclut) et les événements de sauvegarde (`backup.read`).
    expect((await scelle(["*", "admin.websocket.install"])).sort()).toEqual([
      "admin.websocket.install",
      "backup.read",
      "websocket.connect",
    ]);
  });

  it("ne scelle pour un invité que la lecture, quels que soient ses droits d'agir", async () => {
    const permissions = await scelle([
      "console.read",
      "console.send",
      "power.start",
      "power.stop",
      "power.restart",
      "power.kill",
      "backups.read",
    ]);
    expect(permissions.sort()).toEqual(["backup.read", "websocket.connect"]);
  });

  it("ne scelle rien de plus que ce que l'invité peut lire", async () => {
    expect(await scelle(["console.read"])).toEqual(["websocket.connect"]);
    expect(await scelle(["files.read"])).toEqual([]);
  });
});

/**
 * Le jeton de transfert porte son préfixe `Bearer `.
 *
 * **Relevé en faisant tourner deux daemons côte à côte, pas en lisant du
 * code.** Le daemon de départ pose l'en-tête `Authorization` verbatim, sans
 * rien y ajouter ; celui d'arrivée découpe sur l'espace et exige « Bearer »
 * en premier morceau. Un jeton nu faisait échouer **tout** transfert, et le
 * refus n'existait que dans le journal du node de départ — le panel, lui,
 * marquait le serveur « en transfert » puis revenait en arrière sans rien
 * dire.
 */
describe("jeton de transfert", () => {
  const NODE = "33333333-3333-3333-3333-333333333333";
  const SECRET = "jeton-du-node-de-destination";

  /** Un double de base qui rend une seule ligne, quelle que soit la requête. */
  function dbAvecNode(row: Record<string, unknown>): Database {
    const chaine: Record<string, unknown> = {};
    chaine.select = () => chaine;
    chaine.from = () => chaine;
    chaine.where = () => chaine;
    chaine.limit = async () => [row];
    return chaine as unknown as Database;
  }

  it("préfixe le jeton, et signe avec la clé du node d'arrivée", async () => {
    process.env.APP_SECRET_KEY ??= randomBytes(32).toString("base64");
    const svc = new WingsTokenService(
      dbAvecNode({
        scheme: "https",
        fqdn: "node-b.exemple.fr",
        port: 8080,
        nodeId: NODE,
        // Lié au node d'arrivée, comme en base : relu sous un autre contexte,
        // il ne signerait rien.
        token: encryptRowSecret("nodes.daemon_token_enc", NODE, SECRET),
      }),
    );

    const grant = await svc.transferGrant(SERVER, NODE);

    expect(grant.token.startsWith("Bearer ")).toBe(true);
    expect(grant.url).toBe("https://node-b.exemple.fr:8080/api/transfers");

    // Et ce qui suit le préfixe reste un JWT valide, signé avec la clé du
    // node de destination : c'est lui qui le vérifiera.
    const jwt = grant.token.slice("Bearer ".length);
    const [entete, corps, signature] = jwt.split(".");
    expect(createHmac("sha256", SECRET).update(`${entete}.${corps}`).digest("base64url")).toBe(
      signature,
    );

    const charge = JSON.parse(Buffer.from(corps ?? "", "base64url").toString("utf8"));
    // `sub` porte le serveur et `scope` la portée : le daemon refuse un dépôt
    // qui ne correspond pas, et une portée inconnue lui fait rendre 403.
    expect(charge.sub).toBe(SERVER);
    expect(charge.scope).toBe("transfer");
  });
});

/**
 * La déconnexion ferme les consoles ouvertes **par cette session** (NC-43).
 *
 * Un jeton de console vit dix minutes et Wings ne revérifie rien en cours de
 * route : après `logout`, la console restait ouverte — lecture et commandes —
 * jusqu'à l'expiration. Le jeton est rangé avec la session qui l'a demandé,
 * et c'est elle seule qui le révoque : une prise en main porte l'identifiant
 * du client, et se déconnecter du compte d'un autre ne doit pas couper ses
 * consoles à lui, ni celles de ses autres appareils.
 */
describe("révocation des consoles d'une session qui se ferme", () => {
  function dbAvecNode(): Database {
    const chaine: Record<string, unknown> = {};
    chaine.select = () => chaine;
    chaine.from = () => chaine;
    chaine.innerJoin = () => chaine;
    chaine.where = () => chaine;
    chaine.limit = async () => [
      {
        scheme: "https",
        fqdn: "node.exemple.fr",
        port: 8080,
        nodeId: "44444444-4444-4444-4444-444444444444",
        token: encryptRowSecret(
          "nodes.daemon_token_enc",
          "44444444-4444-4444-4444-444444444444",
          "cle-du-node",
        ),
      },
    ];
    return chaine as unknown as Database;
  }

  function jtiOf(token: string): string {
    const [, corps] = token.split(".");
    return JSON.parse(Buffer.from(corps ?? "", "base64url").toString("utf8")).jti;
  }

  it("rend les jetons émis pour cette session, et seulement eux", async () => {
    process.env.APP_SECRET_KEY ??= randomBytes(32).toString("base64");
    const svc = new WingsTokenService(dbAvecNode());
    const AUTRE_SERVEUR = "44444444-4444-4444-4444-444444444444";

    const ici = await svc.websocketGrant(SERVER, USER, ["*"], "session-du-portable");
    const ailleurs = await svc.websocketGrant(AUTRE_SERVEUR, USER, ["*"], "session-du-portable");
    const telephone = await svc.websocketGrant(SERVER, USER, ["*"], "session-du-telephone");

    const byServer = svc.revocableForSession("session-du-portable");
    expect(Object.fromEntries(byServer)).toEqual({
      [SERVER]: [jtiOf(ici.token)],
      [AUTRE_SERVEUR]: [jtiOf(ailleurs.token)],
    });
    // Rendus une fois : une révocation ne se rejoue pas.
    expect(svc.revocableForSession("session-du-portable").size).toBe(0);
    // Le téléphone du même compte garde sa console.
    expect(svc.revocableFor(SERVER, USER)).toEqual([jtiOf(telephone.token)]);
  });

  it("ne rattache à aucune session un jeton demandé par clé d'API", async () => {
    process.env.APP_SECRET_KEY ??= randomBytes(32).toString("base64");
    const svc = new WingsTokenService(dbAvecNode());
    await svc.websocketGrant(SERVER, USER, ["*"], null);

    expect(svc.revocableForSession("session-du-portable").size).toBe(0);
  });
});
