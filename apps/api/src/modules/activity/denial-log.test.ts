import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOrigin } from "../../common/request-origin";
import type { ActivityService, RecordInput } from "./activity.service";
import { type Denial, DenialLogService } from "./denial-log.service";

/**
 * Journal des refus (NC-12) : consigner sans se laisser remplir.
 *
 * Un refus répété — un script qui boucle sur un jeton périmé, un balayage —
 * écrirait sinon une ligne par requête, et noierait le journal d'audit sous
 * ce qu'il est censé rendre visible.
 */

function journal() {
  const lignes: RecordInput[] = [];
  const activity = {
    record: vi.fn(async (input: RecordInput) => {
      lignes.push(input);
    }),
    labelFor: vi.fn(async () => "Alex Équipier"),
  };
  const svc = new DenialLogService(activity as unknown as ActivityService);
  return { svc, lignes, activity };
}

const refus = (over: Partial<Denial> = {}): Denial => ({
  event: "access.denied",
  actorId: "44444444-4444-4444-4444-444444444444",
  actorType: "user",
  origin: { ip: "82.66.14.201", route: "GET /api/v1/client/servers/:id" },
  properties: { server: "s1" },
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("journal des refus", () => {
  it("consigne le refus, sa route et son adresse, hors de tout serveur", async () => {
    const { svc, lignes } = journal();
    await svc.record(refus());

    expect(lignes).toEqual([
      expect.objectContaining({
        event: "access.denied",
        // Jamais rattaché au journal d'un serveur : son propriétaire y lirait
        // le nom d'un tiers qui a tenté d'y entrer, et un serveur inexistant
        // ferait échouer l'écriture.
        serverId: null,
        actorId: "44444444-4444-4444-4444-444444444444",
        actorLabel: "Alex Équipier",
        ip: "82.66.14.201",
        properties: { route: "GET /api/v1/client/servers/:id", server: "s1" },
      }),
    ]);
  });

  it("nomme « Appelant inconnu » celui qui n'a pas de compte", async () => {
    const { svc, lignes } = journal();
    await svc.record(refus({ event: "node.token_rejected", actorId: null, actorType: "system" }));
    expect(lignes[0]).toMatchObject({ actorId: null, actorLabel: "Appelant inconnu" });
  });

  it("regroupe un refus répété : une ligne à chaque puissance de dix", async () => {
    const { svc, lignes } = journal();
    for (let i = 0; i < 1500; i += 1) await svc.record(refus());

    // 1, 10, 100, 1000 : le volume reste lisible, et le journal aussi.
    expect(lignes.map((l) => l.properties?.occurrences ?? 1)).toEqual([1, 10, 100, 1000]);
  });

  it("repart de zéro une fois la fenêtre écoulée", async () => {
    const { svc, lignes } = journal();
    const debut = Date.now();
    const horloge = vi.spyOn(Date, "now").mockReturnValue(debut);
    await svc.record(refus());
    await svc.record(refus());

    horloge.mockReturnValue(debut + 11 * 60_000);
    await svc.record(refus());

    expect(lignes).toHaveLength(2);
  });

  it("distingue les refus qui ne visent pas la même chose", async () => {
    const { svc, lignes } = journal();
    await svc.record(refus({ properties: { server: "s1" } }));
    await svc.record(refus({ properties: { server: "s2" } }));
    await svc.record(refus({ origin: { ip: "82.66.14.201", route: "GET /autre" } }));
    expect(lignes).toHaveLength(3);
  });

  it("plafonne le nombre de lignes, même quand chaque refus est différent", async () => {
    // Un balayage de milliers d'adresses donne autant de clés distinctes :
    // le regroupement n'y peut rien, le plafond si.
    const { svc, lignes } = journal();
    vi.spyOn(svc.logger, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 1000; i += 1) {
      await svc.record(
        refus({ actorId: null, origin: { ip: `10.0.${i >> 8}.${i & 255}`, route: "GET /x" } }),
      );
    }
    expect(lignes.length).toBeLessThanOrEqual(300);
  });

  it("n'échoue jamais, même quand l'écriture échoue", async () => {
    const { svc, activity } = journal();
    vi.spyOn(svc.logger, "error").mockImplementation(() => undefined);
    activity.labelFor.mockRejectedValueOnce(new Error("base tombée"));
    await expect(svc.record(refus())).resolves.toBeUndefined();
  });
});

describe("origine d'une requête", () => {
  it("retient le gabarit de la route, jamais la chaîne de requête", () => {
    // Une chaîne de requête peut porter un jeton : un refus consigné ne doit
    // pas l'emporter avec lui.
    expect(
      requestOrigin({
        ip: "82.66.14.201",
        method: "GET",
        url: "/api/v1/client/servers/abc/files?token=secret",
        routeOptions: { url: "/api/v1/client/servers/:id/files" },
      }),
    ).toEqual({ ip: "82.66.14.201", route: "GET /api/v1/client/servers/:id/files" });

    expect(requestOrigin({ method: "POST", url: "/x?token=secret" }).route).toBe("POST /x");
  });
});
