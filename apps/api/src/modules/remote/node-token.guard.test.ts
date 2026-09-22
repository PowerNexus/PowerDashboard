import { encryptSecret, generateToken } from "@gamedashboard/auth";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { NodeIdentity, NodeRepository } from "./node.repository";
import { NodeTokenGuard } from "./node-token.guard";

const ENV = { APP_SECRET_KEY: "clé de test des gardes" } as NodeJS.ProcessEnv;
process.env.APP_SECRET_KEY = ENV.APP_SECRET_KEY;

const SECRET = generateToken();

const NODE: NodeIdentity = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "RYZEN-09",
  tokenId: "node-abc",
  tokenSecret: encryptSecret(SECRET),
  maintenanceMode: false,
};

/** Dépôt simulé : seul le node ci-dessus existe. */
function repository(overrides: Partial<NodeRepository> = {}): NodeRepository {
  return {
    findByTokenId: vi.fn(async (tokenId: string) => (tokenId === NODE.tokenId ? NODE : null)),
    recordHeartbeat: vi.fn(async () => {}),
    touch: vi.fn(async () => {}),
    ...overrides,
  } as unknown as NodeRepository;
}

function contextWith(authorization?: string) {
  const request: { headers: Record<string, string | undefined>; node?: NodeIdentity } = {
    headers: authorization === undefined ? {} : { authorization },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("NodeTokenGuard", () => {
  it("accepte un jeton valide", async () => {
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${SECRET}`);
    expect(await new NodeTokenGuard(repository()).canActivate(context)).toBe(true);
  });

  it("horodate le contact à chaque appel authentifié, quel qu'il soit", async () => {
    /*
     * Relevé sur un vrai daemon : le heartbeat ne se déduisait que de
     * l'inventaire des serveurs, demandé au seul démarrage. Wings tournait,
     * envoyait ses relevés d'activité et de SFTP toutes les minutes, et le
     * panel le déclarait « injoignable » sur son propre silence.
     */
    const touch = vi.fn(async () => {});
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${SECRET}`);

    await new NodeTokenGuard(repository({ touch } as Partial<NodeRepository>)).canActivate(context);

    expect(touch).toHaveBeenCalledWith(NODE.id);
  });

  it("n'horodate rien quand le jeton est refusé", async () => {
    // Sinon un inconnu qui frappe à la porte suffirait à faire paraître vivant
    // un node éteint, et la supervision se tairait sur une vraie panne.
    const touch = vi.fn(async () => {});
    const { context } = contextWith(`Bearer ${NODE.tokenId}.mauvais-secret`);

    await new NodeTokenGuard(repository({ touch } as Partial<NodeRepository>)).canActivate(context);

    expect(touch).not.toHaveBeenCalled();
  });

  it("attache le node authentifié à la requête", async () => {
    // Les contrôleurs lisent le node ici et jamais l'en-tête : sans cela, ils
    // auraient l'occasion de refaire la vérification à moitié.
    const { context, request } = contextWith(`Bearer ${NODE.tokenId}.${SECRET}`);
    await new NodeTokenGuard(repository()).canActivate(context);
    expect(request.node).toEqual(NODE);
  });

  it("refuse un secret faux", async () => {
    const { context, request } = contextWith(`Bearer ${NODE.tokenId}.${generateToken()}`);
    expect(await new NodeTokenGuard(repository()).canActivate(context)).toBe(false);
    expect(request.node).toBeUndefined();
  });

  it("refuse un identifiant inconnu", async () => {
    const { context } = contextWith(`Bearer node-inconnu.${SECRET}`);
    expect(await new NodeTokenGuard(repository()).canActivate(context)).toBe(false);
  });

  it("interroge la base même pour un identifiant inconnu", async () => {
    // Le garde calcule un condensat et compare dans tous les cas : sans ce
    // travail inutile en apparence, la durée de réponse révélerait quels
    // identifiants existent et permettrait de les énumérer avant d'attaquer
    // le secret.
    const repo = repository();
    const { context } = contextWith("Bearer node-inconnu.peu-importe");
    await new NodeTokenGuard(repo).canActivate(context);
    expect(repo.findByTokenId).toHaveBeenCalledWith("node-inconnu");
  });

  it("refuse un en-tête absent", async () => {
    const { context } = contextWith(undefined);
    expect(await new NodeTokenGuard(repository()).canActivate(context)).toBe(false);
  });

  it("refuse un autre schéma d'authentification", async () => {
    const { context } = contextWith(`Basic ${NODE.tokenId}.${SECRET}`);
    expect(await new NodeTokenGuard(repository()).canActivate(context)).toBe(false);
  });

  it("refuse un jeton sans séparateur", async () => {
    const { context } = contextWith(`Bearer ${SECRET}`);
    expect(await new NodeTokenGuard(repository()).canActivate(context)).toBe(false);
  });

  it("n'interroge pas la base pour un en-tête malformé", async () => {
    // Inutile de payer une lecture pour une requête qui ne peut pas aboutir :
    // c'est la seule optimisation acceptable ici, car elle ne distingue pas
    // deux jetons bien formés entre eux.
    const repo = repository();
    const { context } = contextWith("Bearer sans-point");
    await new NodeTokenGuard(repo).canActivate(context);
    expect(repo.findByTokenId).not.toHaveBeenCalled();
  });

  it("accepte un secret contenant des points", async () => {
    // Le découpage se fait au premier point seulement. Un `split(".")` naïf
    // tronquerait ce secret et ferait paraître le node injoignable.
    const secret = "une.cle.avec.des.points";
    const repo = repository({
      findByTokenId: vi.fn(async () => ({ ...NODE, tokenSecret: encryptSecret(secret) })),
    } as Partial<NodeRepository>);
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${secret}`);
    expect(await new NodeTokenGuard(repo).canActivate(context)).toBe(true);
  });

  it("refuse le jeton d'un node pour l'identifiant d'un autre", async () => {
    // Le condensat stocké appartient au node trouvé par identifiant : présenter
    // le secret d'un autre node ne peut pas passer.
    const autre = generateToken();
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${autre}`);
    expect(await new NodeTokenGuard(repository()).canActivate(context)).toBe(false);
  });
});
