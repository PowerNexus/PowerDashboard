import { encryptSecret, generateToken } from "@gamedashboard/auth";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Denial, DenialLogService } from "../activity/denial-log.service";
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

/** Le journal des refus, muet : ces tests-ci ne parlent que du jeton. */
const silence = { record: vi.fn(async () => {}) } as unknown as DenialLogService;

/** Le journal des refus, qui retient ce qu'on lui confie. */
function journal() {
  const refus: Denial[] = [];
  const denials = {
    record: vi.fn(async (denial: Denial) => {
      refus.push(denial);
    }),
  } as unknown as DenialLogService;
  return { denials, refus };
}

function contextWith(authorization?: string) {
  const request: {
    headers: Record<string, string | undefined>;
    node?: NodeIdentity;
    ip: string;
    method: string;
    url: string;
    routeOptions: { url: string };
  } = {
    headers: authorization === undefined ? {} : { authorization },
    ip: "203.0.113.9",
    method: "GET",
    url: "/api/remote/servers?page=0",
    routeOptions: { url: "/api/remote/servers" },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("NodeTokenGuard", () => {
  it("accepte un jeton valide", async () => {
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${SECRET}`);
    expect(await new NodeTokenGuard(repository(), silence).canActivate(context)).toBe(true);
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

    await new NodeTokenGuard(repository({ touch } as Partial<NodeRepository>), silence).canActivate(
      context,
    );

    expect(touch).toHaveBeenCalledWith(NODE.id);
  });

  it("n'horodate rien quand le jeton est refusé", async () => {
    // Sinon un inconnu qui frappe à la porte suffirait à faire paraître vivant
    // un node éteint, et la supervision se tairait sur une vraie panne.
    const touch = vi.fn(async () => {});
    const { context } = contextWith(`Bearer ${NODE.tokenId}.mauvais-secret`);

    await new NodeTokenGuard(repository({ touch } as Partial<NodeRepository>), silence).canActivate(
      context,
    );

    expect(touch).not.toHaveBeenCalled();
  });

  it("attache le node authentifié à la requête", async () => {
    // Les contrôleurs lisent le node ici et jamais l'en-tête : sans cela, ils
    // auraient l'occasion de refaire la vérification à moitié.
    const { context, request } = contextWith(`Bearer ${NODE.tokenId}.${SECRET}`);
    await new NodeTokenGuard(repository(), silence).canActivate(context);
    expect(request.node).toEqual(NODE);
  });

  it("refuse un secret faux", async () => {
    const { context, request } = contextWith(`Bearer ${NODE.tokenId}.${generateToken()}`);
    expect(await new NodeTokenGuard(repository(), silence).canActivate(context)).toBe(false);
    expect(request.node).toBeUndefined();
  });

  it("refuse un identifiant inconnu", async () => {
    const { context } = contextWith(`Bearer node-inconnu.${SECRET}`);
    expect(await new NodeTokenGuard(repository(), silence).canActivate(context)).toBe(false);
  });

  it("interroge la base même pour un identifiant inconnu", async () => {
    // Le garde calcule un condensat et compare dans tous les cas : sans ce
    // travail inutile en apparence, la durée de réponse révélerait quels
    // identifiants existent et permettrait de les énumérer avant d'attaquer
    // le secret.
    const repo = repository();
    const { context } = contextWith("Bearer node-inconnu.peu-importe");
    await new NodeTokenGuard(repo, silence).canActivate(context);
    expect(repo.findByTokenId).toHaveBeenCalledWith("node-inconnu");
  });

  it("refuse un en-tête absent", async () => {
    const { context } = contextWith(undefined);
    expect(await new NodeTokenGuard(repository(), silence).canActivate(context)).toBe(false);
  });

  it("refuse un autre schéma d'authentification", async () => {
    const { context } = contextWith(`Basic ${NODE.tokenId}.${SECRET}`);
    expect(await new NodeTokenGuard(repository(), silence).canActivate(context)).toBe(false);
  });

  it("refuse un jeton sans séparateur", async () => {
    const { context } = contextWith(`Bearer ${SECRET}`);
    expect(await new NodeTokenGuard(repository(), silence).canActivate(context)).toBe(false);
  });

  it("n'interroge pas la base pour un en-tête malformé", async () => {
    // Inutile de payer une lecture pour une requête qui ne peut pas aboutir :
    // c'est la seule optimisation acceptable ici, car elle ne distingue pas
    // deux jetons bien formés entre eux.
    const repo = repository();
    const { context } = contextWith("Bearer sans-point");
    await new NodeTokenGuard(repo, silence).canActivate(context);
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
    expect(await new NodeTokenGuard(repo, silence).canActivate(context)).toBe(true);
  });

  it("consigne un jeton refusé, sans son secret (NC-12)", async () => {
    // Un jeton de node volé, essayé depuis ailleurs après sa rotation, ne
    // laissait aucune trace : le refus était silencieux.
    const faux = generateToken();
    const { denials, refus } = journal();
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${faux}`);

    expect(await new NodeTokenGuard(repository(), denials).canActivate(context)).toBe(false);

    expect(refus).toEqual([
      expect.objectContaining({
        event: "node.token_rejected",
        actorId: null,
        origin: { ip: "203.0.113.9", route: "GET /api/remote/servers" },
        properties: { tokenId: NODE.tokenId, node: NODE.id },
      }),
    ]);
    expect(JSON.stringify(refus)).not.toContain(faux);
  });

  it("consigne un identifiant inconnu, sans nommer de node", async () => {
    const { denials, refus } = journal();
    const { context } = contextWith(`Bearer node-inconnu.${SECRET}`);

    await new NodeTokenGuard(repository(), denials).canActivate(context);

    expect(refus[0]?.properties).toEqual({ tokenId: "node-inconnu", node: null });
    expect(JSON.stringify(refus)).not.toContain(SECRET);
  });

  it("consigne un en-tête malformé, mais pas un appel sans en-tête", async () => {
    // Sans en-tête, l'appelant n'a rien présenté : c'est le bruit d'Internet,
    // que le journal d'accès de nginx tient déjà. Un en-tête présent, lui,
    // est une tentative.
    const { denials, refus } = journal();
    await new NodeTokenGuard(repository(), denials).canActivate(contextWith(undefined).context);
    expect(refus).toEqual([]);

    await new NodeTokenGuard(repository(), denials).canActivate(
      contextWith("Bearer sans-point").context,
    );
    expect(refus).toHaveLength(1);
    expect(refus[0]?.properties).toEqual({ tokenId: null, node: null });
  });

  it("ne consigne rien pour un jeton accepté", async () => {
    const { denials, refus } = journal();
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${SECRET}`);
    await new NodeTokenGuard(repository(), denials).canActivate(context);
    expect(refus).toEqual([]);
  });

  it("refuse le jeton d'un node pour l'identifiant d'un autre", async () => {
    // Le condensat stocké appartient au node trouvé par identifiant : présenter
    // le secret d'un autre node ne peut pas passer.
    const autre = generateToken();
    const { context } = contextWith(`Bearer ${NODE.tokenId}.${autre}`);
    expect(await new NodeTokenGuard(repository(), silence).canActivate(context)).toBe(false);
  });
});
