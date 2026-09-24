import { createHmac, randomBytes } from "node:crypto";
import { totpCodeAt, totpStep } from "@gamedashboard/auth";
import { webhookSignaturePayload } from "@gamedashboard/contracts";
import {
  applicationKeys,
  applicationWebhookDeliveries,
  type Database,
  databaseHosts,
  servers,
  webhookDeliveries,
} from "@gamedashboard/db";
import { createDatabase, rotatePassword } from "@gamedashboard/mysql";
import { type ExecutionContext, Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DenialLogService } from "../modules/activity/denial-log.service";
import { DatabaseHostsService } from "../modules/admin/database-hosts.service";
import { InfrastructureService } from "../modules/admin/infrastructure.service";
import { NodeConfigurationService } from "../modules/admin/node-configuration.service";
import { PlatformSettingsService } from "../modules/admin/platform-settings.service";
import { TwoFactorRepository } from "../modules/auth/two-factor.repository";
import { DatabasesService } from "../modules/client/databases.service";
import { MysqlProvisionerService } from "../modules/client/mysql-provisioner.service";
import { ServerWebhooksService } from "../modules/client/server-webhooks.service";
import { NodeRepository } from "../modules/remote/node.repository";
import { NodeTokenGuard } from "../modules/remote/node-token.guard";
import { WebhookDispatcherService } from "../modules/webhooks/webhook-dispatcher.service";
import { WebhookRegistryService } from "../modules/webhooks/webhook-registry.service";
import { seedLocation, seedNode, seedServer, seedUser } from "../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../test/throwaway-database";

/*
 * Aucun hôte MySQL ici : le paquet est remplacé, et l'on regarde avec quel
 * mot de passe d'administration le panel l'aurait appelé.
 */
vi.mock("@gamedashboard/mysql", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gamedashboard/mysql")>()),
  probeHost: vi.fn(async () => ({ version: "8.4.0", canCreate: true })),
  createDatabase: vi.fn(async () => undefined),
  rotatePassword: vi.fn(async () => undefined),
  dropDatabase: vi.fn(async () => undefined),
}));

/**
 * Chaque secret chiffré en base est lié à sa ligne (audit ASVS, NC-18).
 *
 * Le scénario est celui d'un attaquant qui écrit en base sans connaître la
 * clé maître : il ne peut rien chiffrer, mais il peut **recopier** un chiffré
 * valide qu'il maîtrise — celui de son propre compte, de son node, de son
 * point d'entrée — sur la ligne d'une victime. Sans contexte, GCM n'y voyait
 * rien : la valeur recopiée se relisait, et le panel l'employait comme celle
 * de la victime.
 *
 * Chaque cas passe par le service réel, à l'écriture comme à la lecture : un
 * contexte écrit d'une façon et relu d'une autre rendrait le secret illisible
 * pour tout le monde, et c'est la vérification « avant recopie » qui le verrait.
 */
describe.skipIf(!HAS_DATABASE)("secrets liés à leur ligne (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;

  /** Recopie la valeur de la ligne `depuis` sur la ligne `vers`. */
  async function recopier(
    table: string,
    colonne: string,
    cle: string,
    depuis: string,
    vers: string,
  ): Promise<void> {
    await db.execute(
      sql.raw(
        `update "${table}" set "${colonne}" = (select "${colonne}" from "${table}" where "${cle}" = '${depuis}') where "${cle}" = '${vers}'`,
      ),
    );
  }

  beforeAll(async () => {
    Logger.overrideLogger(false);
    process.env.APP_SECRET_KEY ??= "cle-de-test-des-secrets-lies-pour-vitest";
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        "truncate table users, locations, nodes, servers, eggs, nests, allocations, database_hosts, databases, webhooks, application_keys, settings cascade",
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("secret TOTP : celui d'un autre compte, recopié, ne passe pas le second facteur", async () => {
    const totp = new TwoFactorRepository(db);
    const victime = await seedUser(db);
    const attaquant = await seedUser(db);
    await totp.beginSetup(victime);
    const secretAttaquant = await totp.beginSetup(attaquant);

    await recopier("user_credentials_totp", "secret_enc", "user_id", attaquant, victime);
    const code = totpCodeAt(secretAttaquant, totpStep());

    expect(await totp.confirmSetup(victime, code).catch(() => false)).toBe(false);
    // Le même code sur sa propre ligne passe : écriture et relecture
    // s'accordent sur le contexte.
    expect(await totp.confirmSetup(attaquant, code)).toBe(true);
  });

  it("jeton de node : celui d'un autre node, recopié, n'ouvre pas les routes du daemon", async () => {
    const infrastructure = new InfrastructureService(db);
    const locationId = await seedLocation(db);
    const machine = (name: string) =>
      infrastructure.createNode({
        name,
        locationId,
        category: null,
        subcategory: null,
        fqdn: `${name}.node.test`,
        scheme: "https",
        daemonPort: 8080,
        daemonSftpPort: 2022,
        memoryMb: 8192,
        diskMb: 102_400,
        cpuCores: 4,
        isPublic: true,
      });
    const victime = await machine("victime");
    const compromis = await machine("compromis");
    // Le journal des refus n'est pas le sujet ici : il se tait.
    const garde = new NodeTokenGuard(new NodeRepository(db), {
      record: async () => undefined,
    } as unknown as DenialLogService);
    const appel = (authorization: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
      }) as unknown as ExecutionContext;
    const configuration = new NodeConfigurationService(db, new PlatformSettingsService(db));

    expect(await garde.canActivate(appel(`Bearer ${victime.tokenId}.${victime.token}`))).toBe(true);
    expect((await configuration.fileFor(victime.id)).yaml).toContain(victime.token);

    await recopier("nodes", "daemon_token_enc", "id", compromis.id, victime.id);

    expect(await garde.canActivate(appel(`Bearer ${victime.tokenId}.${compromis.token}`))).toBe(
      false,
    );
    await expect(configuration.fileFor(victime.id)).rejects.toThrow();
    expect(await garde.canActivate(appel(`Bearer ${compromis.tokenId}.${compromis.token}`))).toBe(
      true,
    );
  });

  it("mot de passe d'un hôte MySQL : celui d'un autre hôte, recopié, n'est pas présenté", async () => {
    const hotes = new DatabaseHostsService(db);
    const hote = (name: string, password: string) =>
      hotes.create({
        name,
        host: `${name}.mysql.test`,
        port: 3306,
        username: "gamedashboard",
        password,
        nodeId: null,
        maxDatabases: null,
      });
    const victime = await hote("victime", "mdp-hote-victime");
    const autre = await hote("autre", "mdp-hote-autre");
    const provisioner = new MysqlProvisionerService();
    const ligne = async (id: string) => {
      const [row] = await db.select().from(databaseHosts).where(eq(databaseHosts.id, id));
      if (!row) throw new Error("hôte introuvable");
      return row;
    };

    await provisioner.rotatePassword(await ligne(victime.id), "u_test", "%", "nouveau");
    expect(vi.mocked(rotatePassword).mock.calls[0]?.[0].password).toBe("mdp-hote-victime");

    await recopier("database_hosts", "password_enc", "id", autre.id, victime.id);

    await expect(
      provisioner.rotatePassword(await ligne(victime.id), "u_test", "%", "nouveau"),
    ).rejects.toThrow();
    expect(vi.mocked(rotatePassword)).toHaveBeenCalledTimes(1);
  });

  it("mot de passe d'une base : celui d'une autre base, recopié, n'est pas réaffiché", async () => {
    await new DatabaseHostsService(db).create({
      name: "partage",
      host: "partage.mysql.test",
      port: 3306,
      username: "gamedashboard",
      password: "mdp-hote",
      nodeId: null,
      maxDatabases: null,
    });
    const owner = await seedUser(db);
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    const serverId = await seedServer(db, { nodeId, ownerId: owner });
    await db.update(servers).set({ databaseLimit: 2 }).where(eq(servers.id, serverId));
    const bases = new DatabasesService(db, new MysqlProvisionerService());

    const victime = await bases.create(serverId, "victime", "%");
    const autre = await bases.create(serverId, "autre", "%");
    const poses = vi.mocked(createDatabase).mock.calls.map((call) => call[3]);
    expect(poses).toHaveLength(2);
    // L'hôte a bien été joint avec son propre mot de passe d'administration.
    expect(vi.mocked(createDatabase).mock.calls[0]?.[0].password).toBe("mdp-hote");
    expect(await bases.password(serverId, victime.id)).toBe(poses[0]);

    await recopier("databases", "password_enc", "id", autre.id, victime.id);

    await expect(bases.password(serverId, victime.id)).rejects.toThrow();
    expect(await bases.password(serverId, autre.id)).toBe(poses[1]);
  });

  describe("secrets de signature des rappels", () => {
    /** Les envois interceptés : adresse et signature. */
    let envois: { url: string; signature: string; body: string }[];

    beforeEach(() => {
      envois = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          const headers = init.headers as Record<string, string>;
          envois.push({
            url,
            signature: headers["x-gamedashboard-signature"] ?? "",
            body: String(init.body),
          });
          return new Response("ok", { status: 200 });
        }),
      );
    });

    /** L'envoi est-il signé par ce secret ? */
    function signePar(envoi: { signature: string; body: string }, secret: string): boolean {
      const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(envoi.signature) ?? [];
      if (!t || !v1) return false;
      const attendu = createHmac("sha256", secret)
        .update(webhookSignaturePayload(Number(t), envoi.body))
        .digest("hex");
      return attendu === v1;
    }

    it("point d'entrée applicatif : le secret d'un autre, recopié, ne signe rien", async () => {
      const [cle] = await db
        .insert(applicationKeys)
        .values({
          name: "Boutique",
          prefix: `gd_app_${randomBytes(4).toString("hex")}`,
          keyHash: "test",
          scopes: [],
        })
        .returning({ id: applicationKeys.id });
      if (!cle) throw new Error("clé non créée");
      const registre = new WebhookRegistryService(db);
      const creer = (chemin: string) =>
        registre.create({
          applicationKeyId: cle.id,
          url: `https://localhost/${chemin}`,
          events: ["server.created"],
        });
      const victime = await creer("victime");
      const attaquant = await creer("attaquant");
      const livrer = (webhookId: string) =>
        db.insert(applicationWebhookDeliveries).values({
          webhookId,
          event: "server.created",
          payload: { essai: true },
          nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
        });
      const repartiteur = new WebhookDispatcherService(db);

      await livrer(victime.webhook.id);
      await repartiteur.tick();
      expect(envois).toHaveLength(1);
      expect(signePar(envois[0] as (typeof envois)[number], victime.secret)).toBe(true);

      await recopier(
        "application_webhooks",
        "secret_enc",
        "id",
        attaquant.webhook.id,
        victime.webhook.id,
      );
      await livrer(victime.webhook.id);
      await repartiteur.tick();

      expect(envois.slice(1).some((envoi) => signePar(envoi, attaquant.secret))).toBe(false);
    });

    it("rappel d'un client : le secret d'un autre, recopié, ne signe rien", async () => {
      const owner = await seedUser(db);
      const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
      const serverId = await seedServer(db, { nodeId, ownerId: owner });
      const rappels = new ServerWebhooksService(db);
      const creer = (chemin: string) =>
        rappels.create(serverId, { url: `https://1.1.1.1/${chemin}`, events: ["backup.failed"] });
      const victime = await creer("victime");
      const attaquant = await creer("attaquant");
      const livrer = (webhookId: string) =>
        db.insert(webhookDeliveries).values({
          webhookId,
          event: "backup.failed",
          payload: { essai: true },
          nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
        });
      const repartiteur = new WebhookDispatcherService(db);

      await livrer(victime.webhook.id);
      await repartiteur.tick();
      expect(envois).toHaveLength(1);
      expect(signePar(envois[0] as (typeof envois)[number], victime.secret)).toBe(true);

      await recopier("webhooks", "secret_enc", "id", attaquant.webhook.id, victime.webhook.id);
      await livrer(victime.webhook.id);
      await repartiteur.tick();

      expect(envois.slice(1).some((envoi) => signePar(envoi, attaquant.secret))).toBe(false);
    });
  });

  it("réglage secret : la valeur d'un autre réglage, recopiée, n'est pas relue", async () => {
    const reglages = new PlatformSettingsService(db);
    await reglages.save({ "smtp.password": "mdp-smtp", "google.clientSecret": "secret-google" });
    expect(await reglages.secret("google.clientSecret")).toBe("secret-google");

    await recopier("settings", "value", "key", "smtp.password", "google.clientSecret");

    // Illisible, donc traité comme non renseigné : jamais le mot de passe SMTP.
    expect(await reglages.secret("google.clientSecret")).toBe("");
    expect(await reglages.secret("smtp.password")).toBe("mdp-smtp");
  });
});
