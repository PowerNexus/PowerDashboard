import type { Database } from "@gamedashboard/db";
import { describe, expect, it, vi } from "vitest";
import { RemoteActivityService, type WingsActivity } from "./remote-activity.service";

const NODE = "11111111-1111-1111-1111-111111111111";
const MINE = "22222222-2222-2222-2222-222222222222";
const THEIRS = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";

/**
 * Base simulée : premier `select` les serveurs du node, second les utilisateurs
 * connus. `insert` capture ce qui aurait été écrit.
 */
function service(options: { servers?: string[]; users?: string[] } = {}) {
  const inserted: Record<string, unknown>[] = [];
  let call = 0;

  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          call += 1;
          if (call === 1) return (options.servers ?? [MINE]).map((id) => ({ id }));
          return (options.users ?? [USER]).map((id) => ({
            id,
            first: "Alex",
            last: "Equipier",
          }));
        },
      }),
    }),
    insert: () => ({
      values: async (rows: Record<string, unknown>[]) => {
        inserted.push(...rows);
      },
    }),
  } as unknown as Database;

  return { svc: new RemoteActivityService(db), inserted };
}

const entry = (over: Partial<WingsActivity> = {}): WingsActivity => ({
  server: MINE,
  event: "server:sftp.write",
  user: USER,
  ip: "82.66.14.201",
  timestamp: "2026-09-16T12:00:00Z",
  ...over,
});

describe("journal remonté par le daemon", () => {
  it("écarte un serveur qui n'appartient pas à ce node", async () => {
    // Sans cette condition, un node compromis écrirait dans le journal des
    // serveurs hébergés ailleurs.
    const { svc, inserted } = service({ servers: [MINE] });
    await svc.record(NODE, [entry({ server: THEIRS })]);
    expect(inserted).toEqual([]);
  });

  it("garde les entrées légitimes", async () => {
    const { svc, inserted } = service();
    await svc.record(NODE, [entry()]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      serverId: MINE,
      event: "server:sftp.write",
      actorId: USER,
      actorType: "user",
      ip: "82.66.14.201",
    });
  });

  it("attribue au système un auteur inconnu, plutôt qu'au hasard", async () => {
    // Un journal qui accuse à tort ne vaut rien : mieux vaut « Daemon » qu'un
    // nom emprunté à un identifiant que le node aurait inventé.
    const { svc, inserted } = service({ users: [] });
    await svc.record(NODE, [entry({ user: "99999999-9999-9999-9999-999999999999" })]);
    expect(inserted[0]).toMatchObject({ actorId: null, actorType: "system", actorLabel: "Daemon" });
  });

  it("accepte un événement sans auteur", async () => {
    const { svc, inserted } = service({ users: [] });
    await svc.record(NODE, [entry({ user: null })]);
    expect(inserted[0]).toMatchObject({ actorType: "system" });
  });

  it("conserve l'horodatage du daemon", async () => {
    // Un lot peut arriver en retard après une coupure : c'est le daemon qui
    // sait quand l'action a eu lieu.
    const { svc, inserted } = service();
    await svc.record(NODE, [entry({ timestamp: "2026-09-15T08:30:00Z" })]);
    expect(inserted[0]?.at).toBe("2026-09-15T08:30:00.000Z");
  });

  it("retombe sur maintenant pour un horodatage inexploitable", async () => {
    const { svc, inserted } = service();
    await svc.record(NODE, [entry({ timestamp: "pas une date" })]);
    expect(Number.isNaN(new Date(inserted[0]?.at as string).getTime())).toBe(false);
  });

  it("normalise des métadonnées qui ne sont pas un objet", async () => {
    // Wings envoie `null`, une chaîne ou un objet ; la colonne attend un objet.
    const { svc, inserted } = service();
    await svc.record(NODE, [entry({ metadata: "/home/container/server.properties" })]);
    expect(inserted[0]?.properties).toEqual({ value: "/home/container/server.properties" });
  });

  it("borne la taille d'un lot", async () => {
    const { svc, inserted } = service();
    await svc.record(
      NODE,
      Array.from({ length: 500 }, () => entry()),
    );
    expect(inserted).toHaveLength(200);
  });

  it("n'écrit rien pour un lot vide", async () => {
    const { svc, inserted } = service();
    await svc.record(NODE, []);
    expect(inserted).toEqual([]);
  });

  it("écarte une entrée sans événement", async () => {
    const { svc, inserted } = service();
    await svc.record(NODE, [entry({ event: undefined })]);
    expect(inserted).toEqual([]);
  });
});

describe("journal du panel", () => {
  it("ne fait pas échouer l'action qu'il décrit", async () => {
    // Refuser un redémarrage parce que le journal est plein transformerait un
    // problème d'audit en panne de service.
    const { ActivityService } = await import("../activity/activity.service");
    const db = {
      insert: () => ({
        values: () => Promise.reject(new Error("disque plein")),
      }),
    } as unknown as Database;

    const svc = new ActivityService(db);
    // Le journal du processus est muselé : ce test vérifie que l'erreur ne
    // remonte pas à l'appelant, pas qu'elle s'écrit.
    vi.spyOn(svc.logger, "error").mockImplementation(() => undefined);

    await expect(
      svc.record({
        event: "server.power",
        serverId: MINE,
        actorId: USER,
        actorType: "user",
        actorLabel: "Alex",
      }),
    ).resolves.toBeUndefined();
  });
});
