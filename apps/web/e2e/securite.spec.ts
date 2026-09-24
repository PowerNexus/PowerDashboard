import type { Page } from "@playwright/test";

import { expect, fermerAvertissement, seConnecter, test } from "./fixtures";

/**
 * La CSP à nonce (PLAN §5.4), éprouvée sur les pages réellement servies.
 *
 * Le défaut corrigé : `script-src 'unsafe-inline'` laissait s'exécuter
 * n'importe quel script en ligne, donc celui qu'une faille XSS aurait glissé
 * dans une page. La politique ne protégeait les scripts de rien.
 *
 * Deux dangers opposés, et ce fichier tient les deux :
 * - une politique trop lâche, qui ne protège pas — les en-têtes ;
 * - une politique trop stricte, qui casse le panel sans bruit — une page dont
 *   les scripts sont refusés s'affiche quand même, figée. D'où le relevé des
 *   violations sur chaque écran, et un parcours qui exige l'hydratation.
 */

/** Les violations de CSP relevées par la page, depuis son premier octet. */
async function suivreViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("__gdViolation", (texte: string) => violations.push(texte));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __gdViolation: (t: string) => void }).__gdViolation(
        `${e.violatedDirective} ← ${e.blockedURI || "(en ligne)"}`,
      );
    });
  });
  return violations;
}

const PUBLIQUES = ["/login", "/forgot", "/status", "/offline"];
const PRIVEES = ["/", "/servers", "/account", "/account/security", "/admin"];

test.describe("CSP à nonce", () => {
  test("les scripts ne passent que par un nonce, neuf à chaque requête", async ({ request }) => {
    const politiques = await Promise.all(
      [1, 2].map(async () => (await request.get("/login")).headers()["content-security-policy"]),
    );

    const nonces = politiques.map((politique) => {
      const scripts = (politique ?? "").split(";").find((d) => d.trim().startsWith("script-src"));
      expect(scripts, "directive script-src absente").toBeDefined();
      expect(scripts).toContain("'strict-dynamic'");
      expect(scripts).not.toContain("'unsafe-inline'");
      expect(scripts).not.toContain("'unsafe-eval'");
      // Monaco est servi par le panel (NC-22) : plus aucun CDN dans la politique.
      expect(politique).not.toContain("jsdelivr");
      return /'nonce-([A-Za-z0-9+/=]{22,})'/.exec(scripts ?? "")?.[1];
    });

    expect(nonces[0]).toBeTruthy();
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  test("la fenêtre du panel est isolée des autres sites (COOP)", async ({ request }) => {
    const reponse = await request.get("/login");
    expect(reponse.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  });

  test("un script injecté dans la page ne s'exécute pas", async ({ page }) => {
    const violations = await suivreViolations(page);
    await page.goto("/login");

    /*
     * Ce que ferait une faille XSS : du HTML fourni par un tiers, rendu tel
     * quel, qui porte un gestionnaire d'événement. L'ancienne politique
     * (`'unsafe-inline'`) le laissait s'exécuter.
     *
     * Et non une balise `<script>` ajoutée par `page.evaluate` : Chrome tient
     * le code de l'outil de test pour digne de confiance, et
     * `'strict-dynamic'` étend cette confiance à ce qu'il insère — le test
     * passerait au vert ou au rouge pour une raison qui n'a rien à voir.
     */
    await page.evaluate(() => {
      const zone = document.createElement("div");
      zone.innerHTML = '<img src="/introuvable.png" onerror="window.__injecte = true">';
      document.body.appendChild(zone);
    });

    await expect.poll(() => violations.length).toBeGreaterThan(0);
    const execute = await page.evaluate(
      () => (window as unknown as { __injecte?: boolean }).__injecte === true,
    );
    expect(execute).toBe(false);
  });

  test("les écrans publics se rendent sans violation", async ({ page }) => {
    const violations = await suivreViolations(page);
    for (const url of PUBLIQUES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
    }
    expect(violations).toEqual([]);
  });

  test("les écrans du panel se rendent sans violation, et répondent", async ({ page }) => {
    const violations = await suivreViolations(page);

    // La connexion passe par un formulaire hydraté : si les scripts de Next
    // étaient refusés, le bouton ne ferait rien et ce geste échouerait.
    await seConnecter(page);
    for (const url of PRIVEES) {
      await page.goto(url);
      await fermerAvertissement(page);
      await page.waitForLoadState("networkidle");
    }
    expect(violations).toEqual([]);
  });
});
