import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingConnection } from "../billing-provider";
import { ClientxcmsProvider } from "./clientxcms.provider";
import { HostbillProvider } from "./hostbill.provider";
import { WhmcsProvider } from "./whmcs.provider";

/**
 * Les trois protocoles, contre des réponses écrites d'après la documentation
 * de chaque facturier (et le code source de ClientXCMS). Aucune instance
 * réelle n'est jointe.
 */

type Handler = (request: { url: URL; body: URLSearchParams; headers: Headers }) => unknown;

function stubFetch(handler: Handler) {
  const requests: { url: URL; body: URLSearchParams; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const request = {
      url: new URL(input.toString()),
      body: new URLSearchParams((init?.body as URLSearchParams | undefined) ?? ""),
      headers: new Headers(init?.headers),
    };
    requests.push(request);
    const reply = handler(request);
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests };
}

afterEach(() => vi.unstubAllGlobals());

const connection = (apiUrl: string, apiId = "panel"): BillingConnection => ({
  apiUrl,
  apiId,
  apiKey: "cle-secrete",
});

describe("HostBill", () => {
  const hb = connection("https://hb.exemple.fr/admin/api.php");

  it("emploie les noms d'appel et le filtre de HostBill, clé dans le corps", async () => {
    // Non-régression : l'ancienne lecture appelait `clients/getClients` avec
    // `email=`, ce que HostBill ne connaît pas.
    const { requests } = stubFetch(() => ({
      success: true,
      clients: [{ id: "6", email: "paul@ex.fr" }],
    }));
    const clients = await new HostbillProvider().clientsByEmail(hb, "paul@ex.fr");

    expect(clients).toEqual([{ id: "6", email: "paul@ex.fr" }]);
    expect(requests[0]?.body.get("call")).toBe("getClients");
    expect(requests[0]?.body.get("filter[email]")).toBe("paul@ex.fr");
    expect(requests[0]?.body.get("api_key")).toBe("cle-secrete");
    expect(requests[0]?.url.search).toBe("");
  });

  it("lit l'échéance dans `next_due`, et parcourt les pages", async () => {
    const pages: Record<string, unknown[]> = {
      "0": [
        {
          id: "42",
          domain: "survie",
          name: "Minecraft",
          status: "Active",
          next_due: "2099-01-02",
          total: "8.95",
        },
      ],
      // HostBill numérote peut-être à partir de 1 : la page 1 répète la 0.
      "1": [
        {
          id: "42",
          domain: "survie",
          name: "Minecraft",
          status: "Active",
          next_due: "2099-01-02",
          total: "8.95",
        },
      ],
      "2": [{ id: "43", name: "Rust", status: "Suspended", next_due: "0000-00-00", total: "12" }],
    };
    const { requests } = stubFetch(({ body }) => ({
      success: true,
      accounts: pages[body.get("page") ?? ""] ?? [],
    }));

    const services = await new HostbillProvider().servicesOf(hb, "6");

    expect(requests.map((r) => r.body.get("call"))).toEqual(Array(4).fill("getClientAccounts"));
    expect(services).toMatchObject([
      {
        id: "42",
        name: "survie",
        plan: "Minecraft",
        state: "active",
        dueDate: "2099-01-02",
        amount: "8.95",
      },
      { id: "43", name: "Rust", state: "suspended", dueDate: null, daysLeft: null },
    ]);
  });

  it("prend `success: false` pour un refus, pas pour une liste vide", async () => {
    stubFetch(() => ({ success: false, error: ["API key invalid"] }));
    await expect(new HostbillProvider().clientsByEmail(hb, "paul@ex.fr")).rejects.toThrow(
      "API key invalid",
    );
  });

  it("refuse une adresse en http, sans rien envoyer", async () => {
    const { fetch } = stubFetch(() => ({ success: true }));
    await expect(
      new HostbillProvider().clientsByEmail(
        connection("http://hb.exemple.fr/admin/api.php"),
        "a@b.fr",
      ),
    ).rejects.toThrow("https");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("WHMCS", () => {
  const wh = connection("https://wh.exemple.fr/includes/api.php");

  it("cherche par adresse avec GetClientsDetails, identifiants dans le corps", async () => {
    const { requests } = stubFetch(() => ({
      result: "success",
      userid: 12,
      client: { id: 12, email: "paul@ex.fr" },
    }));
    expect(await new WhmcsProvider().clientsByEmail(wh, "paul@ex.fr")).toEqual([
      { id: "12", email: "paul@ex.fr" },
    ]);
    expect(Object.fromEntries(requests[0]?.body ?? [])).toMatchObject({
      action: "GetClientsDetails",
      identifier: "panel",
      secret: "cle-secrete",
      responsetype: "json",
      email: "paul@ex.fr",
    });
  });

  it("rend une liste vide pour un client introuvable, et lève pour une clé refusée", async () => {
    stubFetch(() => ({ result: "error", message: "Client Not Found" }));
    expect(await new WhmcsProvider().clientsByEmail(wh, "x@ex.fr")).toEqual([]);

    stubFetch(() => ({ result: "error", message: "Invalid IP 203.0.113.9" }));
    await expect(new WhmcsProvider().clientsByEmail(wh, "x@ex.fr")).rejects.toThrow("Invalid IP");
  });

  it("lit toutes les pages de produits, et seulement ceux du client", async () => {
    // WHMCS rend 25 produits si l'on ne dit rien : un client qui en a 26 en
    // perdait un à l'écran et dans la cloche.
    const product = (id: number, clientid = 12) => ({
      id,
      clientid,
      name: "Minecraft",
      domain: `srv-${id}`,
      status: "Active",
      nextduedate: "2099-05-01",
      recurringamount: "5.00",
    });
    const { requests } = stubFetch(({ body }) => {
      if (body.get("action") === "GetClientsDetails") {
        return { result: "success", client: { id: 12, email: "p@ex.fr", currency_code: "EUR" } };
      }
      const start = Number(body.get("limitstart"));
      const all = [...Array.from({ length: 101 }, (_, i) => product(i + 1)), product(999, 13)];
      return {
        result: "success",
        totalresults: all.length,
        products: { product: all.slice(start, start + Number(body.get("limitnum"))) },
      };
    });

    const services = await new WhmcsProvider().servicesOf(wh, "12");

    expect(services).toHaveLength(101);
    expect(services.some((s) => s.id === "999")).toBe(false);
    expect(services[0]).toMatchObject({
      name: "srv-1",
      plan: "Minecraft",
      amount: "5.00",
      currency: "EUR",
    });
    expect(requests.filter((r) => r.body.get("action") === "GetClientsProducts")).toHaveLength(2);
  });

  it("ramène `Terminated` à une fin de service", async () => {
    stubFetch(({ body }) =>
      body.get("action") === "GetClientsDetails"
        ? { result: "success", client: { id: 12, email: "p@ex.fr" } }
        : {
            result: "success",
            totalresults: 1,
            products: { product: [{ id: 1, clientid: 12, status: "Terminated" }] },
          },
    );
    expect((await new WhmcsProvider().servicesOf(wh, "12"))[0]?.state).toBe("cancelled");
  });
});

describe("ClientXCMS", () => {
  it("appelle l'API d'application avec le jeton en en-tête, quelle que soit l'adresse saisie", async () => {
    for (const apiUrl of [
      "https://cx.exemple.fr",
      "https://cx.exemple.fr/",
      "https://cx.exemple.fr/api/application",
    ]) {
      const { requests } = stubFetch(() => ({ data: [], meta: { last_page: 1 } }));
      await new ClientxcmsProvider().clientsByEmail(connection(apiUrl, ""), "paul@ex.fr");
      expect(requests[0]?.url.pathname).toBe("/api/application/customers");
      expect(requests[0]?.url.searchParams.get("filter[email]")).toBe("paul@ex.fr");
      expect(requests[0]?.headers.get("authorization")).toBe("Bearer cle-secrete");
    }
  });

  it("ne garde que les services du client exact, malgré le filtre partiel", async () => {
    // `filter[customer_id]=4` fait un LIKE %4% : il rend aussi les clients 14 et 42.
    stubFetch(({ url }) => ({
      data:
        url.searchParams.get("page") === "1"
          ? [
              {
                id: 1,
                customer_id: 4,
                name: "Survie",
                status: "active",
                expires_at: "2099-03-04 10:00:00",
                billing: "monthly",
                currency: "EUR",
                pricing: { monthly: "7.50" },
              },
              { id: 2, customer_id: 14, name: "Autre", status: "active" },
              { id: 3, customer_id: 42, name: "Autre", status: "active" },
            ]
          : [
              { id: 4, customer_id: 4, name: "Créatif", status: "expired" },
              { id: 5, customer_id: 4, name: "Masqué", status: "hidden" },
            ],
      meta: { last_page: 2 },
    }));

    const services = await new ClientxcmsProvider().servicesOf(
      connection("https://cx.exemple.fr", ""),
      "4",
    );

    expect(services.map((s) => s.id)).toEqual(["1", "4"]);
    expect(services[0]).toMatchObject({
      dueDate: "2099-03-04",
      amount: "7.50",
      currency: "EUR",
      state: "active",
    });
    expect(services[1]?.state).toBe("cancelled");
  });

  it("prend un 403 pour une clé refusée", async () => {
    stubFetch(() => new Response("{}", { status: 403 }));
    await expect(
      new ClientxcmsProvider().clientsByEmail(connection("https://cx.exemple.fr", ""), "p@ex.fr"),
    ).rejects.toThrow("refusé la clé");
  });

  it("rend `null` pour un client inconnu par identifiant", async () => {
    stubFetch(() => new Response("{}", { status: 404 }));
    expect(
      await new ClientxcmsProvider().clientById(connection("https://cx.exemple.fr", ""), "9"),
    ).toBeNull();
  });
});
