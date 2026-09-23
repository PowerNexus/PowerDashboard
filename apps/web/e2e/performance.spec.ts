import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BrowserContext } from "@playwright/test";
import lighthouse, { desktopConfig } from "lighthouse";

import { expect, seConnecter, test } from "./fixtures";

/**
 * Lighthouse (PLAN §12.1 : « perf (Lighthouse > 90) »), mesuré sur
 * l'application compilée plutôt qu'annoncé.
 *
 * Quatre catégories, chacune avec son seuil. Le message d'échec nomme les
 * audits qui ont coûté des points : « performance 84 » seul oblige à relancer
 * Lighthouse à la main pour savoir où regarder.
 *
 * **Profil bureau.** Le profil mobile de Lighthouse simule un téléphone
 * d'entrée de gamme sur un réseau lent : sur la machine du runner, qui fait
 * tourner la CI en parallèle, il mesurerait surtout la charge de la machine.
 * L'affichage mobile, lui, est tenu par les autres suites sur le projet
 * « mobile ».
 */
const SEUILS = {
  performance: 0.9,
  accessibility: 0.9,
  "best-practices": 0.9,
  seo: 0.8,
} as const;

const PAGES = [
  { nom: "connexion", url: "/login", connecte: false },
  { nom: "état des services", url: "/status", connecte: false },
  { nom: "accueil du panel", url: "/", connecte: true },
];

// Un navigateur à lui : Lighthouse pilote Chrome par son port de débogage, et
// deux mesures en parallèle se disputeraient la même machine.
test.describe.configure({ mode: "serial" });

test.describe("Lighthouse", () => {
  let contexte: BrowserContext;
  let profil: string;
  const port = 9322;

  test.beforeAll(async ({ playwright, launchOptions }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Mesuré une fois, sur le profil bureau.");
    profil = mkdtempSync(join(tmpdir(), "gd-lighthouse-"));
    /*
     * Contexte **persistant** : c'est le contexte par défaut du navigateur,
     * celui où Lighthouse ouvre ses onglets. Un contexte ordinaire de
     * Playwright est isolé, et la session ouverte par la connexion n'y serait
     * pas visible.
     */
    contexte = await playwright.chromium.launchPersistentContext(profil, {
      ...launchOptions,
      args: [...(launchOptions.args ?? []), `--remote-debugging-port=${port}`],
    });
  });

  test.afterAll(async () => {
    await contexte?.close();
    if (profil) rmSync(profil, { recursive: true, force: true });
  });

  for (const { nom, url, connecte } of PAGES) {
    test(nom, async ({ baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const page = contexte.pages()[0] ?? (await contexte.newPage());
      /*
       * L'avertissement de bêta, lu une fois pour toutes : posé dans le profil,
       * il vaut pour les onglets que Lighthouse ouvre ensuite. Sans cela, la
       * fenêtre couvrirait chaque page mesurée.
       */
      await page.goto(new URL("/login", baseURL).toString());
      await page.evaluate(() => localStorage.setItem("gd-beta-notice", "1"));
      if (connecte) await seConnecter(page);

      const resultat = await lighthouse(
        new URL(url, baseURL).toString(),
        {
          port,
          logLevel: "error",
          onlyCategories: Object.keys(SEUILS),
          // Garder la session ouverte par `seConnecter` : sans cela,
          // Lighthouse vide le stockage et mesure la page de connexion.
          disableStorageReset: true,
        },
        desktopConfig,
      );
      if (!resultat) throw new Error(`Lighthouse n'a rien rendu pour ${url}.`);
      const { categories, audits } = resultat.lhr;

      // Les scores au rapport, même au vert : savoir qu'on passe à 91 ou à 99
      // n'appelle pas la même attention.
      const scores = Object.keys(SEUILS)
        .map((id) => `${id} ${Math.round((categories[id]?.score ?? 0) * 100)}`)
        .join(", ");
      testInfo.annotations.push({ type: "lighthouse", description: `${url} : ${scores}` });
      console.log(`Lighthouse ${url} : ${scores}`);

      const echecs = Object.entries(SEUILS).flatMap(([id, seuil]) => {
        const score = categories[id]?.score ?? 0;
        if (score >= seuil) return [];
        const couteux = (categories[id]?.auditRefs ?? [])
          .filter((ref) => ref.weight > 0 && (audits[ref.id]?.score ?? 1) < 1)
          .map(
            (ref) => `    - ${audits[ref.id]?.title} (${audits[ref.id]?.displayValue ?? "échec"})`,
          )
          .slice(0, 5);
        return [`${id} : ${Math.round(score * 100)} < ${seuil * 100}`, ...couteux];
      });

      expect(echecs, `« ${nom} » (${url}) :\n${echecs.join("\n")}`).toEqual([]);
    });
  }
});
