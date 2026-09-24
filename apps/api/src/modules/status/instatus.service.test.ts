import type { Database } from "@gamedashboard/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstatusService } from "./instatus.service";

/**
 * La page Instatus est une adresse saisie par l'administration, que le panel
 * appelle lui-même, et dont il **publie** le résultat dans la bannière de
 * chaque page (rapport ASVS, NC-56). En `http:` ou vers une adresse interne,
 * c'était un moyen de faire émettre au panel des requêtes vers son propre
 * réseau, et d'en afficher la réponse à tous.
 */
function service(pageUrl: string) {
  const rows = [
    { key: "instatus.pageUrl", value: pageUrl },
    { key: "instatus.showBanner", value: true },
  ];
  const db = {
    select: () => ({ from: () => ({ where: async () => rows }) }),
  } as unknown as Database;
  const instatus = new InstatusService(db);
  // Les refus sont écrits au journal du processus ; ils n'ont rien à faire
  // dans la sortie des tests.
  (instatus as unknown as { logger: { warn: () => void } }).logger = { warn: () => undefined };
  return instatus;
}

describe("page Instatus", () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));

  afterEach(() => {
    vi.unstubAllGlobals();
    fetch.mockClear();
  });

  it.each([
    ["en http", "http://status.gamedashboard.fr"],
    ["vers la boucle locale", "https://127.0.0.1"],
    ["vers un réseau privé", "https://10.0.0.8"],
    ["vers le service de métadonnées", "https://169.254.169.254"],
    ["vers un nom interne", "https://status.localhost"],
  ])("n'appelle pas une page %s", async (_, pageUrl) => {
    vi.stubGlobal("fetch", fetch);
    const summary = await service(pageUrl).summary();
    expect(fetch).not.toHaveBeenCalled();
    expect(summary.state).toBe("unknown");
  });

  it("appelle une page publique en https", async () => {
    vi.stubGlobal("fetch", fetch);
    await service("https://93.184.216.34").summary();
    expect(fetch).toHaveBeenCalledWith("https://93.184.216.34/summary.json", expect.anything());
  });
});
