import { type Database, servers } from "@gamedashboard/db";
import { describe, expect, it, vi } from "vitest";
import { RemoteActivityService, type WingsActivity } from "./remote-activity.service";

const NODE = "11111111-1111-1111-1111-111111111111";
const MINE = "22222222-2222-2222-2222-222222222222";
const THEIRS = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";

/** Il y a `jours` jours : l'horodatage est borné autour de maintenant. */
const ilYa = (jours: number) => new Date(Date.now() - jours * 24 * 3600_000).toISOString();

/**
 * Base simulée : les serveurs du node (lecture simple), puis les couples
 * (serveur, compte) liés (lecture avec jointures) — chaque compte connu l'est
 * à `MINE`. `insert` capture ce qui aurait été écrit. Le lien lui-même se
 * vérifie contre une vraie base, dans `remote-activity.integration.test.ts`.
 */
function service(options: { servers?: string[]; users?: string[] } = {}) {
  const inserted: Record<string, unknown>[] = [];

  const db = {
    select: () => {
      let table: unknown;
      let joined = false;
      const chain = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        innerJoin: () => {
          joined = true;
          return chain;
        },
        leftJoin: () => chain,
        where: async () => {
          // La sous-requête des sous-utilisateurs n'est jamais attendue seule.
          if (table !== servers) return [];
          if (!joined) return (options.servers ?? [MINE]).map((id) => ({ id }));
          return (options.users ?? [USER]).map((userId) => ({
            serverId: MINE,
            userId,
            first: "Alex",
            last: "Equipier",
          }));
        },
      };
      return chain;
    },
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
  timestamp: ilYa(1),
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
    const retard = ilYa(9);
    await svc.record(NODE, [entry({ timestamp: retard })]);
    expect(inserted[0]?.at).toBe(retard);
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
