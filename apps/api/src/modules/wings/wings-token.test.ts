import { createHmac, randomBytes } from "node:crypto";
import { encryptSecret } from "@gamedashboard/auth";
import type { Database } from "@gamedashboard/db";
import { describe, expect, it } from "vitest";
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
        token: encryptSecret(SECRET),
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
