import { BRAND_IMAGE_MAX_BYTES } from "@gamedashboard/contracts";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { checkedImage } from "./brand-images.service";
import { sendBrandImage } from "./branding.controller";

/** Réponse Fastify réduite à ce que la route emploie. */
function reponse() {
  const etat = { status: 0, headers: {} as Record<string, string>, body: undefined as unknown };
  const reply = {
    status(code: number) {
      etat.status = code;
      return reply;
    },
    header(name: string, value: string) {
      etat.headers[name] = value;
      return reply;
    },
    send(payload?: unknown) {
      etat.body = payload;
    },
  };
  return { reply, etat };
}

const IMAGE = { contentType: "image/png", sha256: "ab12", bytes: Buffer.from([1, 2, 3]) };

describe("images de marque — service de l'image", () => {
  it("sert l'image sous son type exact, sans reniflage, en cache immuable", () => {
    const { reply, etat } = reponse();
    sendBrandImage(reply, IMAGE, undefined);
    expect(etat.status).toBe(200);
    expect(etat.body).toEqual(IMAGE.bytes);
    expect(etat.headers).toMatchObject({
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
      etag: '"ab12"',
      "cache-control": "public, max-age=31536000, immutable",
    });
    expect(etat.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("répond 304 sans corps quand le navigateur a déjà cette version", () => {
    for (const entete of ['"ab12"', 'W/"ab12"', '"autre", "ab12"']) {
      const { reply, etat } = reponse();
      sendBrandImage(reply, IMAGE, entete);
      expect(etat.status).toBe(304);
      expect(etat.body).toBeUndefined();
    }
  });
});

describe("images de marque — corps reçu", () => {
  it("refuse un corps qui n'est pas binaire, ou vide", () => {
    expect(() => checkedImage({ file: "x" })).toThrow(BadRequestException);
    expect(() => checkedImage(Buffer.alloc(0))).toThrow(BadRequestException);
  });

  it("refuse une image au-delà de la taille admise", () => {
    expect(() => checkedImage(Buffer.alloc(BRAND_IMAGE_MAX_BYTES + 1))).toThrow(
      PayloadTooLargeException,
    );
    expect(checkedImage(Buffer.alloc(BRAND_IMAGE_MAX_BYTES)).length).toBe(BRAND_IMAGE_MAX_BYTES);
  });
});
