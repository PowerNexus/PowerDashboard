import { randomBytes } from "node:crypto";
import type { BilledService } from "@gamedashboard/contracts";
import { type Database, settings, users } from "@gamedashboard/db";
import { describe, expect, it, vi } from "vitest";
import { encryptRowSecret } from "../../common/row-secrets";
import { type BillingProviders, BillingService } from "./billing.service";
import type { BillingClient, BillingProvider } from "./billing-provider";

/**
 * La façade de la facturation : quel facturier on interroge, et qui voit les
 * échéances de qui. Les facturiers sont remplacés par des doubles ; leurs
 * protocoles ont leurs propres tests.
 */

const SERVICE: BilledService = {
  id: "7",
  name: "Survie",
  plan: "Minecraft 4 Go",
  state: "active",
  dueDate: null,
  daysLeft: null,
  amount: "9.99",
  currency: "EUR",
};

function fakeProvider(
  kind: BillingProvider["kind"],
  directory: Record<string, string> = {},
): BillingProvider & { calls: string[] } {
  const calls: string[] = [];
  const clients = Object.entries(directory).map(([id, email]): BillingClient => ({ id, email }));
  return {
    kind,
    calls,
    clientById: vi.fn(async (_c, id: string) => {
      calls.push(`clientById:${id}`);
      return clients.find((client) => client.id === id) ?? null;
    }),
    // Comme HostBill et ClientXCMS : une recherche **partielle**.
    clientsByEmail: vi.fn(async (_c, email: string) => {
      calls.push(`clientsByEmail:${email}`);
      return clients.filter((client) => client.email.includes(email));
    }),
    servicesOf: vi.fn(async (_c, clientId: string) => {
      calls.push(`servicesOf:${clientId}`);
      return [{ ...SERVICE, id: `${clientId}-1` }];
    }),
  };
}

// La clé d'API se range chiffrée : il faut une clé maître, même d'essai.
process.env.APP_SECRET_KEY ??= randomBytes(32).toString("base64");

function setup(options: {
  values: Record<string, string>;
  user?: { email: string; externalId: string | null };
  providers?: Partial<BillingProviders>;
}) {
  const providers: BillingProviders = {
    hostbill: fakeProvider("hostbill"),
    whmcs: fakeProvider("whmcs"),
    clientxcms: fakeProvider("clientxcms"),
    ...options.providers,
  };
  const settingRows = Object.entries(options.values).map(([key, value]) => ({
    key,
    value: key === "billing.apiKey" ? encryptRowSecret("settings.value", key, value) : value,
  }));
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () =>
          table === settings ? settingRows : table === users && options.user ? [options.user] : [],
      }),
    }),
  } as unknown as Database;

  const service = new BillingService(db, providers);
  (service as unknown as { logger: object }).logger = {
    warn: () => undefined,
    error: () => undefined,
  };
  return { service, providers };
}

const CONNECTED = {
  "billing.apiUrl": "https://facturation.exemple.fr/api",
  "billing.apiId": "panel",
  "billing.apiKey": "secret",
  "billing.clientUrl": "https://facturation.exemple.fr/client",
};

describe("choix du facturier", () => {
  it("interroge le facturier choisi, et lui seul", async () => {
    // Non-régression : avec « WHMCS » choisi, le panel envoyait des appels
    // HostBill à WHMCS, et chaque client lisait « facturation injoignable ».
    const whmcs = fakeProvider("whmcs", { "12": "paul@ex.fr" });
    const hostbill = fakeProvider("hostbill", { "12": "paul@ex.fr" });
    const { service } = setup({
      values: { ...CONNECTED, "billing.provider": "whmcs" },
      user: { email: "paul@ex.fr", externalId: null },
      providers: { whmcs, hostbill },
    });

    const summary = await service.summaryFor("u");

    expect(hostbill.calls).toEqual([]);
    expect(whmcs.calls).toEqual(["clientsByEmail:paul@ex.fr", "servicesOf:12"]);
    expect(summary).toMatchObject({ configured: true, provider: "whmcs", unreachable: false });
    expect(summary.services.map((s) => s.id)).toEqual(["12-1"]);
  });

  it.each(["none", "custom", "", "inconnu"])("reste silencieux pour « %s »", async (value) => {
    const { service, providers } = setup({
      values: { ...CONNECTED, "billing.provider": value },
      user: { email: "paul@ex.fr", externalId: null },
    });
    const summary = await service.summaryFor("u");
    expect(summary).toMatchObject({ configured: false, provider: null, services: [] });
    for (const provider of Object.values(providers)) {
      expect((provider as ReturnType<typeof fakeProvider>).calls).toEqual([]);
    }
  });

  it("reste silencieux tant qu'il manque l'adresse ou la clé", async () => {
    const { service } = setup({
      values: { "billing.provider": "hostbill", "billing.apiUrl": CONNECTED["billing.apiUrl"] },
      user: { email: "paul@ex.fr", externalId: null },
    });
    expect((await service.summaryFor("u")).configured).toBe(false);
  });

  it("n'exige pas d'identifiant d'API pour ClientXCMS, qui n'emploie qu'un jeton", async () => {
    const clientxcms = fakeProvider("clientxcms", { "3": "paul@ex.fr" });
    const { service } = setup({
      values: { ...CONNECTED, "billing.apiId": "", "billing.provider": "clientxcms" },
      user: { email: "paul@ex.fr", externalId: null },
      providers: { clientxcms },
    });
    expect((await service.summaryFor("u")).services).toHaveLength(1);
  });

  it("dit « injoignable », et non « aucun service », quand le facturier ne répond pas", async () => {
    const hostbill = fakeProvider("hostbill");
    hostbill.clientsByEmail = vi.fn(async () => {
      throw new Error("délai dépassé");
    });
    const { service } = setup({
      values: { ...CONNECTED, "billing.provider": "hostbill" },
      user: { email: "paul@ex.fr", externalId: null },
      providers: { hostbill },
    });
    expect(await service.summaryFor("u")).toMatchObject({
      configured: true,
      unreachable: true,
      services: [],
      clientUrl: CONNECTED["billing.clientUrl"],
    });
  });
});

describe("qui voit les échéances de qui", () => {
  it("suit l'identifiant externe quand sa fiche porte la même adresse", async () => {
    const whmcs = fakeProvider("whmcs", { "42": "Paul@Ex.fr " });
    const { service } = setup({
      values: { ...CONNECTED, "billing.provider": "whmcs" },
      user: { email: "paul@ex.fr", externalId: "42" },
      providers: { whmcs },
    });
    await service.summaryFor("u");
    expect(whmcs.calls).toEqual(["clientById:42", "servicesOf:42"]);
  });

  it("ignore un identifiant externe venu d'un autre facturier", async () => {
    // Le client n° 42 de HostBill n'est pas le n° 42 de WHMCS. Après un
    // changement de facturier, suivre l'identifiant montrerait à Paul les
    // échéances d'Alice.
    const whmcs = fakeProvider("whmcs", { "42": "alice@ex.fr", "7": "paul@ex.fr" });
    const { service } = setup({
      values: { ...CONNECTED, "billing.provider": "whmcs" },
      user: { email: "paul@ex.fr", externalId: "42" },
      providers: { whmcs },
    });
    const summary = await service.summaryFor("u");
    expect(whmcs.calls).not.toContain("servicesOf:42");
    expect(summary.services.map((s) => s.id)).toEqual(["7-1"]);
  });

  it("ne retient que l'adresse exacte d'une recherche partielle", async () => {
    const hostbill = fakeProvider("hostbill", { "5": "paul@ex.fr.co" });
    const { service } = setup({
      values: { ...CONNECTED, "billing.provider": "hostbill" },
      user: { email: "paul@ex.fr", externalId: null },
      providers: { hostbill },
    });
    const summary = await service.summaryFor("u");
    expect(summary).toMatchObject({ configured: true, unreachable: false, services: [] });
    expect(hostbill.calls).not.toContain("servicesOf:5");
  });
});

describe("essai de connexion", () => {
  it("dit ce qui manque quand rien n'est réglé", async () => {
    const { service } = setup({ values: { "billing.provider": "custom" } });
    expect(await service.probe("admin@ex.fr")).toMatchObject({ ok: false, provider: null });
  });

  it("rend la phrase du facturier quand il refuse", async () => {
    const whmcs = fakeProvider("whmcs");
    whmcs.clientsByEmail = vi.fn(async () => {
      throw new Error("Invalid IP 203.0.113.9");
    });
    const { service } = setup({
      values: { ...CONNECTED, "billing.provider": "whmcs" },
      providers: { whmcs },
    });
    expect(await service.probe("admin@ex.fr")).toEqual({
      ok: false,
      provider: "whmcs",
      knowsCaller: false,
      error: "Invalid IP 203.0.113.9",
    });
  });

  it("dit si l'adresse de l'administrateur est connue du facturier", async () => {
    const hostbill = fakeProvider("hostbill", { "1": "admin@ex.fr" });
    const { service } = setup({
      values: { ...CONNECTED, "billing.provider": "hostbill" },
      providers: { hostbill },
    });
    expect(await service.probe("admin@ex.fr")).toEqual({
      ok: true,
      provider: "hostbill",
      knowsCaller: true,
      error: null,
    });
    // L'essai ne lit aucun service : il ne montre rien d'un client.
    expect(hostbill.calls).toEqual(["clientsByEmail:admin@ex.fr"]);
  });
});
