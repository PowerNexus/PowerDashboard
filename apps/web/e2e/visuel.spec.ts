import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Page, TestInfo } from "@playwright/test";

import { expect, fermerAvertissement, seConnecter, test } from "./fixtures";

/**
 * Régressions visuelles (PLAN §12.2) : chaque écran comparé à une capture de
 * référence, au pixel près ou presque.
 *
 * Les autres suites disent qu'un bouton existe et qu'il répond ; aucune ne
 * voit qu'une marge a sauté, qu'un jeton de couleur a changé de valeur ou
 * qu'un composant déborde sur mobile. Ces captures, si.
 *
 * **Les références se prennent sur le runner, jamais ailleurs.** Le rendu des
 * polices change d'une machine à l'autre : une image prise dans une session
 * distante ferait échouer la CI sur des différences d'anticrénelage. Le
 * workflow « Captures de référence » (`captures.yml`), lancé à la main,
 * les prend sur le runner et les commite. Tant qu'une référence manque, son
 * test est sauté, annoncé comme tel, plutôt que rouge.
 */

const PUBLIQUES = [
  { nom: "connexion", url: "/login" },
  { nom: "mot-de-passe-oublie", url: "/forgot" },
  { nom: "etat-des-services", url: "/status" },
  { nom: "hors-ligne", url: "/offline" },
  { nom: "page-introuvable", url: "/page-qui-n-existe-pas" },
];

const PRIVEES = [
  { nom: "accueil", url: "/" },
  { nom: "mes-serveurs", url: "/servers" },
  { nom: "mon-compte", url: "/account" },
  { nom: "securite", url: "/account/security" },
  { nom: "administration", url: "/admin" },
];

/**
 * Saute le test si sa référence n'existe pas encore, sauf quand on les prend.
 *
 * Sans cela, la première CI après l'ajout d'un écran échouerait sur « aucune
 * capture de référence », que personne ne peut corriger depuis une PR : la
 * capture doit venir du runner.
 */
function exigerReference(testInfo: TestInfo, fichier: string): void {
  const prise = ["all", "changed"].includes(testInfo.config.updateSnapshots);
  const chemin = testInfo.snapshotPath(fichier, { kind: "screenshot" });
  test.skip(
    !prise && !existsSync(chemin),
    `Capture de référence absente (${fichier}) : lancer le workflow « Captures de référence ».`,
  );
}

/** Attend que la page soit immobile : écran de démarrage parti, polices chargées. */
async function stabiliser(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // L'écran de démarrage se retire de lui-même après son animation : le
  // capturer donnerait la même image sur tous les écrans.
  await page.locator(".gd-splash-gate").waitFor({ state: "detached", timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function comparer(page: Page, nom: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${nom}.png`, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    /*
     * Ce qui change d'une exécution à l'autre sans que l'interface change :
     * les dates et heures, et les durées relatives (« il y a 3 minutes »).
     * Masquées d'un aplat, elles gardent leur place dans la mise en page.
     */
    mask: [page.locator("time"), page.locator("[data-instable]")],
    // Les listes qui changent de taille : voir la feuille.
    stylePath: join(test.info().project.testDir, "captures.css"),
    // Un pixel isolé d'anticrénelage ne dit rien ; un bloc déplacé, si.
    maxDiffPixelRatio: 0.002,
  });
}

test.describe("régressions visuelles des écrans publics", () => {
  for (const { nom, url } of PUBLIQUES) {
    test(nom, async ({ page }, testInfo) => {
      exigerReference(testInfo, `${nom}.png`);
      await page.goto(url);
      await fermerAvertissement(page);
      await stabiliser(page);
      await comparer(page, nom);
    });
  }
});

test.describe("régressions visuelles des écrans du panel", () => {
  for (const { nom, url } of PRIVEES) {
    test(nom, async ({ page }, testInfo) => {
      exigerReference(testInfo, `${nom}.png`);
      await seConnecter(page);
      await page.goto(url);
      await fermerAvertissement(page);
      await stabiliser(page);
      await comparer(page, nom);
    });
  }
});
