import { describe, expect, it } from "vitest";
import { filtrerReponse, relayBrandImage } from "./brand-image";

/**
 * Relais des images de marque : seules des images d'un type admis passent,
 * sous leur type exact, et jamais un document qui s'exécuterait sous le
 * domaine du panel.
 */
describe("relais des images de marque", () => {
  const image = (type: string, status = 200) =>
    new Response(status === 304 ? null : new Uint8Array([1, 2, 3]), {
      status,
      headers: {
        "content-type": type,
        etag: '"abc"',
        "cache-control": "public, max-age=31536000, immutable",
        "set-cookie": "fuite=1",
      },
    });

  it("sert une image admise avec son type, son ETag et nosniff", () => {
    const reponse = filtrerReponse(image("image/png"));
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("content-type")).toBe("image/png");
    expect(reponse.headers.get("etag")).toBe('"abc"');
    expect(reponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(reponse.headers.get("cache-control")).toContain("immutable");
    // Rien d'autre ne traverse le relais.
    expect(reponse.headers.get("set-cookie")).toBeNull();
  });

  it("refuse un SVG ou du HTML, même rangé en base", () => {
    expect(filtrerReponse(image("image/svg+xml")).status).toBe(502);
    expect(filtrerReponse(image("text/html")).status).toBe(502);
  });

  it("relaie le 304 sans corps, et le 404 sans le garder en cache", async () => {
    const pasModifie = filtrerReponse(image("", 304));
    expect(pasModifie.status).toBe(304);
    expect(await pasModifie.text()).toBe("");

    const absente = filtrerReponse(new Response("{}", { status: 404 }));
    expect(absente.status).toBe(404);
    expect(absente.headers.get("cache-control")).toBe("no-store");
  });

  it("refuse un identifiant qui n'est pas un UUID sans appeler l'API", async () => {
    expect((await relayBrandImage("../../api/v1/admin/settings", null)).status).toBe(404);
  });
});
