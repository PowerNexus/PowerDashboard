import { randomBytes } from "node:crypto";
import {
  allocations,
  type Database,
  eggs,
  nests,
  resellerQuotas,
  servers,
  users,
} from "@gamedashboard/db";
import { ConflictException } from "@nestjs/common";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import { ResellerQuotaService } from "../reseller/reseller-quota.service";
import type { WebhookEmitterService } from "../webhooks/webhook-emitter.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { CatalogueService } from "./catalogue.service";
import { ServerProvisioningService } from "./server-provisioning.service";

/**
 * L'enveloppe du revendeur, à la création, contre une vraie base.
 *
 * Le quota compte en SQL (consommation relevée, sinon limites) : une doublure
 * de base vérifierait surtout qu'elle est d'accord avec elle-même. Le
 * catalogue, le daemon et les rappels sont des doublures — seule la règle
 * « ce qui se rattache au revendeur tient dans son enveloppe » est sous test.
 */
describe.skipIf(!HAS_DATABASE)("ServerProvisioningService — enveloppe du revendeur", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let service: ServerProvisioningService;

  let revendeur: string;
  let client: string;
  let nodeId: string;
  let locationId: string;
  let eggId: string;

  const OFFRE = {
    id: "offre-test",
    name: "Offre de test",
    memoryMb: 2048,
    diskMb: 10_240,
    cpuPct: 100,
    swapMb: 0,
    backups: 1,
    databases: 0,
    allocations: 1,
    priceLabel: "—",
  };

  const catalogue = {
    plans: vi.fn(async () => [OFFRE]),
    pickNode: vi.fn(async () => nodeId),
    pickNodeForReseller: vi.fn(async () => nodeId),
    nodeCapacity: vi.fn(async () => ({
      id: nodeId,
      ownerId: revendeur,
      maintenanceMode: false,
      freePorts: 50,
      freeMemoryMb: 1_000_000,
      freeDiskMb: 10_000_000,
    })),
  };

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    service = new ServerProvisioningService(
      db,
      catalogue as unknown as CatalogueService,
      { createServer: async () => undefined } as unknown as WingsClientService,
      new ResellerQuotaService(db),
      { emit: async () => undefined } as unknown as WebhookEmitterService,
      { boolean: async () => false } as unknown as PlatformSettingsService,
    );
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        `truncate table reseller_quotas, servers, allocations, eggs, nests, nodes, locations, users cascade`,
      ),
    );
    vi.clearAllMocks();

    revendeur = await seedUser(db);
    await db.update(users).set({ role: "reseller" }).where(eq(users.id, revendeur));
    client = await seedUser(db);

    locationId = await seedLocation(db);
    nodeId = await seedNode(db, { locationId, ownerId: revendeur });

    // Un serveur déjà rattaché au revendeur : l'enveloppe n'en admet qu'un.
    const existant = await seedServer(db, { nodeId, ownerId: client });
    await db.update(servers).set({ resellerId: revendeur }).where(eq(servers.id, existant));
    await db
      .insert(resellerQuotas)
      .values({ userId: revendeur, memoryMb: null, diskMb: null, serversMax: 1 });

    // Des ports libres en nombre : c'est l'enveloppe qui doit refuser, pas le stock.
    await db
      .insert(allocations)
      .values(Array.from({ length: 8 }, (_, i) => ({ nodeId, ip: "127.0.0.1", port: 30_000 + i })));

    const [nest] = await db
      .insert(nests)
      .values({ name: `Famille ${randomBytes(3).toString("hex")}` })
      .returning({ id: nests.id });
    const [egg] = await db
      .insert(eggs)
      .values({
        nestId: nest?.id ?? "",
        name: "Jeu de test",
        startup: "./start",
        installContainer: "debian:bookworm-slim",
        dockerImages: { Debian: "debian:bookworm-slim" },
        enabled: true,
      })
      .returning({ id: eggs.id });
    eggId = egg?.id ?? "";
  });

  async function serveursDuRevendeur(): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(servers)
      .where(eq(servers.resellerId, revendeur));
    return row?.n ?? 0;
  }

  it("refuse une commande guidée passée pour un revendeur dont l'enveloppe est pleine", async () => {
    await expect(
      service.create(
        { id: client, role: "user", onBehalfOf: revendeur },
        { eggId, name: "Commande", variables: {}, planId: OFFRE.id, locationId },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await serveursDuRevendeur()).toBe(1);
  });

  it("laisse passer la même commande quand l'enveloppe a de la place", async () => {
    await db
      .update(resellerQuotas)
      .set({ serversMax: 2 })
      .where(eq(resellerQuotas.userId, revendeur));

    await service.create(
      { id: client, role: "user", onBehalfOf: revendeur },
      { eggId, name: "Commande", variables: {}, planId: OFFRE.id, locationId },
    );

    expect(await serveursDuRevendeur()).toBe(2);
  });
});
