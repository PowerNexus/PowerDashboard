import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerResponseHeaders } from "./response-headers";

/**
 * En-têtes posés sur chaque réponse de l'API (ASVS 14.4.4, 8.2.1).
 *
 * Le défaut : ni `X-Content-Type-Options` ni `Cache-Control` sur les réponses
 * de l'API. Une lecture authentifiée (`/auth/me`, la liste des serveurs)
 * pouvait être gardée par un cache intermédiaire ou par le navigateur, et un
 * corps pouvait être interprété selon ce qu'il contient plutôt que selon son
 * type déclaré. Atténué — l'API n'est jointe que par Next —, mais une route
 * publiée par nginx ou un proxy mal réglé suffisait à l'exposer.
 */

/** Une réponse Fastify réduite à ce que le crochet emploie. */
function reponse(initiaux: Record<string, string> = {}) {
  const entetes = new Map(Object.entries(initiaux));
  return {
    entetes,
    hasHeader: (nom: string) => entetes.has(nom.toLowerCase()),
    header(nom: string, valeur: string) {
      entetes.set(nom.toLowerCase(), valeur);
      return this;
    },
  };
}

type Crochet = (requete: unknown, reponse: unknown, corps: unknown) => Promise<unknown>;

function crochetInscrit(): Crochet {
  const inscrits: { nom: string; crochet: Crochet }[] = [];
  registerResponseHeaders({
    addHook: (nom: string, crochet: Crochet) => {
      inscrits.push({ nom, crochet });
    },
  } as never);
  expect(inscrits.map((i) => i.nom)).toEqual(["onSend"]);
  return (inscrits[0] as { crochet: Crochet }).crochet;
}

describe("en-têtes des réponses de l'API", () => {
  it("interdit de deviner le type et de garder la réponse en cache", async () => {
    const r = reponse();
    const corps = await crochetInscrit()({}, r, '{"user":{}}');

    expect(r.entetes.get("x-content-type-options")).toBe("nosniff");
    expect(r.entetes.get("cache-control")).toBe("no-store");
    // Le corps traverse tel quel : le crochet n'ajoute que des en-têtes.
    expect(corps).toBe('{"user":{}}');
  });

  it("laisse leur cache aux réponses publiques qui le déclarent", async () => {
    // Statut et spécification OpenAPI posent leur propre `Cache-Control` :
    // une supervision les relit en boucle, et c'est voulu.
    const politique = "public, max-age=0, s-maxage=10, stale-while-revalidate=30";
    const r = reponse({ "cache-control": politique });
    await crochetInscrit()({}, r, "{}");

    expect(r.entetes.get("cache-control")).toBe(politique);
    expect(r.entetes.get("x-content-type-options")).toBe("nosniff");
  });

  it("est inscrit au démarrage de l'API", () => {
    const main = readFileSync(join(import.meta.dirname, "..", "main.ts"), "utf8");
    expect(main).toMatch(/registerResponseHeaders\(app\.getHttpAdapter\(\)\.getInstance\(\)\)/);
  });
});
