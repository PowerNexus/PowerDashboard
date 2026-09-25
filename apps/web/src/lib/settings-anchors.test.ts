import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_SETTINGS, settingsAnchor } from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";

/**
 * Les liens vers une section des réglages mènent à une section qui existe.
 *
 * Non-régression : le bandeau d'accueil visait `#reglages-hostbill`, alors que
 * le groupe s'appelle `billing`. Le navigateur ouvrait la page sans y
 * descendre, et aucun test ne le voyait. Les ancres se construisent désormais
 * avec `settingsAnchor` ; ce test rattrape celles qu'on écrirait encore à la
 * main.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("ancres des réglages", () => {
  const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  // Sections déclarées : les groupes du contrat, et les quelques sections que
  // l'écran ajoute lui-même avec un `id` littéral (préréglages, par exemple).
  const declared = new Set([
    ...PLATFORM_SETTINGS.map((group) => settingsAnchor(group.key)),
    ...files.flatMap(({ text }) => [...text.matchAll(/id="(reglages-[\w-]+)"/g)].map((m) => m[1])),
  ]);

  it("chaque lien #reglages-… vise une section déclarée", () => {
    const broken = files.flatMap(({ path, text }) =>
      [...text.matchAll(/#(reglages-[\w-]+)/g)]
        .map((m) => m[1] as string)
        .filter((anchor) => !declared.has(anchor))
        .map((anchor) => `${path.slice(SRC.length)} → #${anchor}`),
    );
    expect(broken).toEqual([]);
  });

  it("la section de la facturation garde une ancre neutre", () => {
    expect(settingsAnchor("billing")).toBe("reglages-billing");
    expect(PLATFORM_SETTINGS.some((group) => group.key === "billing")).toBe(true);
  });
});
