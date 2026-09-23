import { randomBytes } from "node:crypto";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import {
  type AddressInfo,
  createServer as createTcpServer,
  type Server as TcpServer,
} from "node:net";
import { encryptSecret } from "@gamedashboard/auth";
import type { NodeSettingsInput } from "@gamedashboard/contracts";
import { allocations, type Database, nodes } from "@gamedashboard/db";
import { ConflictException, Logger, NotFoundException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { InfrastructureService } from "./infrastructure.service";
import { NodeConfigurationService } from "./node-configuration.service";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * Modification d'un node, contre une vraie base et un faux daemon.
 *
 * Les règles de capacité et de ports vivent en SQL — sommes, verrous, deux
 * façons d'occuper un port — et se vérifient donc sur PostgreSQL.
 *
 * La liaison se vérifie contre un **faux Wings** qui reproduit les trois
 * comportements du vrai dont dépend la sécurité du changement :
 *
 * - `GET /api/system` n'accepte que le jeton du node ;
 * - `POST /api/update` écrit la configuration et répond `applied` ;
 * - **les ports ne changent pas sans redémarrage** : le faux reste sur son
 *   port après une mise à jour, exactement comme Wings. « Redémarrer », dans
 *   ces tests, c'est ouvrir un faux sur le nouveau port.
 *
 * Ce que ce faux ne prouve pas — que Wings réel se comporte bien ainsi —
 * relève du banc `infra/local/`, sur Codiax.
 */

/** Un faux daemon, et ce qu'il a reçu. */
interface FakeWings {
  port: number;
  updates: Array<{ api: { port: number }; system: { sftp: { bind_port: number } } }>;
  close(): Promise<void>;
}

async function fakeWings(
  token: string,
  options: { port?: number; applies?: boolean } = {},
): Promise<FakeWings> {
  const updates: FakeWings["updates"] = [];
  const server: HttpServer = createHttpServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === "GET" && request.url === "/api/system") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"version":"1.11.13"}');
      return;
    }
    if (request.method === "POST" && request.url === "/api/update") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        updates.push(JSON.parse(body));
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ applied: options.applies ?? true }));
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    updates,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Un faux SFTP : il annonce sa bannière SSH, comme celui de Wings. */
async function fakeSftp(port = 0): Promise<{ port: number; close(): Promise<void> }> {
  const server: TcpServer = createTcpServer((socket) => socket.end("SSH-2.0-Go\r\n"));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Un port libre à l'instant, sur lequel rien n'écoute. */
async function freePort(): Promise<number> {
  const probe = await fakeSftp();
  await probe.close();
  return probe.port;
}

describe.skipIf(!HAS_DATABASE)("modification d'un node (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let infrastructure: InfrastructureService;
  let configuration: NodeConfigurationService;
  let locationId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    Logger.overrideLogger(false);
    process.env.APP_SECRET_KEY ??= "clé-de-test-uniquement-pour-vitest";
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    infrastructure = new InfrastructureService(db);
    configuration = new NodeConfigurationService(db, new PlatformSettingsService(db));
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw("truncate table servers, allocations, eggs, nests, nodes, locations, users cascade"),
    );
    locationId = await seedLocation(db);
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const settings = (overrides: Partial<NodeSettingsInput> = {}): NodeSettingsInput => ({
    name: "RYZEN-09",
    locationId,
    category: null,
    subcategory: null,
    memoryMb: 65_536,
    memoryOverallocate: 0,
    diskMb: 1_048_576,
    diskOverallocate: 0,
    cpuCores: 16,
    isPublic: true,
    ...overrides,
  });

  /* --- Capacité ----------------------------------------------------------- */

  describe("capacité", () => {
    it("refuse une baisse sous ce qui est promis aux serveurs, et ne change rien", async () => {
      const nodeId = await seedNode(db, { locationId });
      // Deux serveurs de 2 Go de mémoire et 10 Go de disque chacun.
      const owner = await seedUser(db);
      await seedServer(db, { nodeId, ownerId: owner });
      await seedServer(db, { nodeId, ownerId: owner });

      await expect(
        infrastructure.updateNodeSettings(nodeId, settings({ memoryMb: 3072 })),
      ).rejects.toThrow(/mémoire : 3 Go demandés .* 4 Go sont déjà promis/);

      const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
      expect(row?.memoryMb).toBe(65_536);
    });

    it("refuse aussi le disque", async () => {
      const nodeId = await seedNode(db, { locationId });
      await seedServer(db, { nodeId, ownerId: await seedUser(db) });

      await expect(
        infrastructure.updateNodeSettings(nodeId, settings({ diskMb: 5000 })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("accepte une baisse que la surallocation couvre", async () => {
      const nodeId = await seedNode(db, { locationId });
      await seedServer(db, { nodeId, ownerId: await seedUser(db) });

      await infrastructure.updateNodeSettings(
        nodeId,
        settings({ memoryMb: 1024, memoryOverallocate: 100, name: "Renommé" }),
      );
      const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
      expect(row).toMatchObject({ memoryMb: 1024, memoryOverallocate: 100, name: "Renommé" });
    });

    it("n'accepte qu'une localisation qui existe", async () => {
      const nodeId = await seedNode(db, { locationId });
      await expect(
        infrastructure.updateNodeSettings(
          nodeId,
          settings({ locationId: "00000000-0000-4000-8000-000000000000" }),
        ),
      ).rejects.toThrow(/Localisation inconnue/);
    });
  });

  /* --- Ports -------------------------------------------------------------- */

  describe("stock de ports", () => {
    async function port(nodeId: string, value: number, serverId: string | null = null) {
      const [row] = await db
        .insert(allocations)
        .values({ nodeId, ip: "127.0.0.1", port: value, serverId })
        .returning({ id: allocations.id });
      if (!row) throw new Error("port non créé");
      return row.id;
    }

    it("retire des ports libres", async () => {
      const nodeId = await seedNode(db, { locationId });
      const a = await port(nodeId, 30_001);
      const b = await port(nodeId, 30_002);

      expect(await infrastructure.removeAllocations(nodeId, [a, b])).toEqual({ removed: 2 });
      expect(await infrastructure.allocationsOf(nodeId)).toEqual([]);
    });

    it("refuse le port principal d'un serveur, le nomme, et ne retire rien", async () => {
      const nodeId = await seedNode(db, { locationId });
      await seedServer(db, { nodeId, ownerId: await seedUser(db) });
      const [primary] = await infrastructure.allocationsOf(nodeId);
      const free = await port(nodeId, 30_003);
      if (!primary) throw new Error("port principal absent");

      // Le port principal n'a pas de `server_id` : c'est le serveur qui le
      // désigne. Ne regarder que la colonne l'aurait fait passer pour libre.
      await expect(infrastructure.removeAllocations(nodeId, [free, primary.id])).rejects.toThrow(
        new RegExp(`127\\.0\\.0\\.1:${primary.port} \\(Serveur de test\\)`),
      );
      expect(await infrastructure.allocationsOf(nodeId)).toHaveLength(2);
    });

    it("refuse un port supplémentaire attribué à un serveur", async () => {
      const nodeId = await seedNode(db, { locationId });
      const serverId = await seedServer(db, { nodeId, ownerId: await seedUser(db) });
      const extra = await port(nodeId, 30_004, serverId);

      await expect(infrastructure.removeAllocations(nodeId, [extra])).rejects.toBeInstanceOf(
        ConflictException,
      );
      const listed = await infrastructure.allocationsOf(nodeId);
      expect(listed.find((a) => a.id === extra)).toMatchObject({
        serverId,
        serverName: "Serveur de test",
        isPrimary: false,
      });
    });

    it("refuse un port d'une autre machine", async () => {
      const nodeId = await seedNode(db, { locationId });
      const elsewhere = await port(await seedNode(db, { locationId }), 30_005);

      await expect(infrastructure.removeAllocations(nodeId, [elsewhere])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  /* --- Liaison ------------------------------------------------------------ */

  describe("liaison au daemon", () => {
    async function nodeOn(wings: { port: number }, token: string, sftpPort = 2022) {
      const nodeId = await seedNode(db, { locationId });
      await db
        .update(nodes)
        .set({
          fqdn: "127.0.0.1",
          scheme: "http",
          daemonPort: wings.port,
          daemonSftpPort: sftpPort,
          daemonTokenEnc: encryptSecret(token),
        })
        .where(eq(nodes.id, nodeId));
      return nodeId;
    }

    const stored = async (nodeId: string) => {
      const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
      return row;
    };

    it("n'enregistre pas un nouveau port tant que Wings n'a pas redémarré", async () => {
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token);
      const nodeId = await nodeOn(wings, token);
      const next = await freePort();

      const outcome = await configuration.rebind(nodeId, {
        fqdn: "127.0.0.1",
        scheme: "http",
        daemonPort: next,
        daemonSftpPort: 2022,
      });

      // Le daemon a reçu la configuration, mais écoute toujours sur l'ancien
      // port : l'enregistrer maintenant couperait le panel de la machine.
      expect(outcome.status).toBe("restart_required");
      expect(wings.updates.at(-1)?.api.port).toBe(next);
      expect((await stored(nodeId))?.daemonPort).toBe(wings.port);

      // « Redémarrage » : le daemon rouvre sur le nouveau port. La même demande
      // le constate, et l'enregistre.
      // L'ancien daemon s'arrête avec le redémarrage : la poussée à l'ancienne
      // adresse échoue, et c'est la vérification qui doit trancher.
      await wings.close();
      const restarted = await fakeWings(token, { port: next });
      cleanups.push(restarted.close);
      const confirmed = await configuration.rebind(nodeId, {
        fqdn: "127.0.0.1",
        scheme: "http",
        daemonPort: next,
        daemonSftpPort: 2022,
      });
      expect(confirmed.status).toBe("applied");
      expect((await stored(nodeId))?.daemonPort).toBe(next);
    });

    it("refuse sans rien écrire quand le daemon est injoignable, et rend le fichier", async () => {
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token);
      const nodeId = await nodeOn(wings, token);
      await wings.close();

      const outcome = await configuration.rebind(nodeId, {
        fqdn: "localhost",
        scheme: "http",
        daemonPort: wings.port,
        daemonSftpPort: 2022,
      });

      expect(outcome.status).toBe("refused");
      expect(outcome.failure).toMatch(/n'a pas répondu/);
      // Le fichier à déposer porte la **nouvelle** liaison et le jeton actuel.
      expect(outcome.file).toContain(`port: ${wings.port}`);
      expect(outcome.file).toContain(`token: '${token}'`);
      expect((await stored(nodeId))?.fqdn).toBe("127.0.0.1");
    });

    it("refuse sans rien écrire quand le daemon ignore les mises à jour du panel", async () => {
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token, { applies: false });
      cleanups.push(wings.close);
      const nodeId = await nodeOn(wings, token);

      const outcome = await configuration.rebind(nodeId, {
        fqdn: "127.0.0.1",
        scheme: "http",
        daemonPort: await freePort(),
        daemonSftpPort: 2022,
      });
      expect(outcome.status).toBe("refused");
      expect(outcome.failure).toMatch(/ignore_panel_config_updates/);
      expect((await stored(nodeId))?.daemonPort).toBe(wings.port);
    });

    it("enregistre un changement de nom que le daemon honore déjà", async () => {
      // Le nouveau nom désigne la même machine : le daemon y répond avec son
      // jeton dès la poussée faite, sans redémarrage.
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token);
      cleanups.push(wings.close);
      const nodeId = await nodeOn(wings, token);

      const outcome = await configuration.rebind(nodeId, {
        fqdn: "localhost",
        scheme: "http",
        daemonPort: wings.port,
        daemonSftpPort: 2022,
      });
      expect(outcome).toMatchObject({ status: "applied", changed: ["fqdn"] });
      expect((await stored(nodeId))?.fqdn).toBe("localhost");
    });

    it("ne se fie pas à un autre daemon qui répondrait à la nouvelle adresse", async () => {
      // Un service quelconque sur le nouveau port ne prouve rien : seul le
      // jeton de ce node en fait la preuve.
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token);
      const stranger = await fakeWings("un-autre-jeton");
      cleanups.push(wings.close, stranger.close);
      const nodeId = await nodeOn(wings, token);

      const outcome = await configuration.rebind(nodeId, {
        fqdn: "127.0.0.1",
        scheme: "http",
        daemonPort: stranger.port,
        daemonSftpPort: 2022,
      });
      expect(outcome.status).toBe("restart_required");
      expect((await stored(nodeId))?.daemonPort).toBe(wings.port);
    });

    it("attend la bannière SSH sur le nouveau port SFTP", async () => {
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token);
      cleanups.push(wings.close);
      const nodeId = await nodeOn(wings, token);
      const next = await freePort();
      const target = {
        fqdn: "127.0.0.1",
        scheme: "http" as const,
        daemonPort: wings.port,
        daemonSftpPort: next,
      };

      expect((await configuration.rebind(nodeId, target)).status).toBe("restart_required");
      expect(wings.updates.at(-1)?.system.sftp.bind_port).toBe(next);
      expect((await stored(nodeId))?.daemonSftpPort).toBe(2022);

      const sftp = await fakeSftp(next);
      cleanups.push(sftp.close);
      expect((await configuration.rebind(nodeId, target)).status).toBe("applied");
      expect((await stored(nodeId))?.daemonSftpPort).toBe(next);
    });

    it("ne fait rien quand rien ne change", async () => {
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token);
      cleanups.push(wings.close);
      const nodeId = await nodeOn(wings, token);

      const outcome = await configuration.rebind(nodeId, {
        fqdn: "127.0.0.1",
        scheme: "http",
        daemonPort: wings.port,
        daemonSftpPort: 2022,
      });
      expect(outcome.status).toBe("unchanged");
      expect(wings.updates).toHaveLength(0);
    });

    it("refuse une adresse IP en HTTPS avant de toucher au daemon", async () => {
      const token = randomBytes(16).toString("hex");
      const wings = await fakeWings(token);
      cleanups.push(wings.close);
      const nodeId = await nodeOn(wings, token);

      await expect(
        configuration.rebind(nodeId, {
          fqdn: "127.0.0.1",
          scheme: "https",
          daemonPort: wings.port,
          daemonSftpPort: 2022,
        }),
      ).rejects.toThrow(/nom de domaine/);
      expect(wings.updates).toHaveLength(0);
    });
  });

  it("rend capacité et allocation sans que l'une écrase l'autre", async () => {
    const nodeId = await seedNode(db, { locationId });
    await seedServer(db, { nodeId, ownerId: await seedUser(db) });

    const detail = await infrastructure.nodeDetail(nodeId);
    expect(detail).toMatchObject({
      memoryMb: 65_536,
      diskMb: 1_048_576,
      memoryAllocatedMb: 2048,
      diskAllocatedMb: 10_240,
      servers: 1,
    });
  });

  it("n'expose ni le jeton ni son chiffré dans la fiche", async () => {
    const nodeId = await seedNode(db, { locationId });
    const detail = await infrastructure.nodeDetail(nodeId);
    // La fixture chiffre le jeton en « test » : ni la clé ni la valeur ne
    // doivent apparaître.
    expect(JSON.stringify(detail)).not.toMatch(/daemonTokenEnc|"test"/);
  });
});
