import AxeBuilder from "@axe-core/playwright";

import { CHAMP_EMAIL, expect, fermerAvertissement, seConnecter, test } from "./fixtures";

/**
 * Accessibilité, mesurée plutôt qu'affirmée.
 *
 * Le plan annonce WCAG 2.1 AA. C'était une intention, sans rien pour la
 * vérifier : un contraste insuffisant, un champ sans étiquette ou un bouton
 * sans nom accessible passaient tous les autres contrôles. Ceux-là se voient
 * ici, sur la page réellement rendue.
 *
 * **Ce que l'outil ne dit pas.** axe attrape ce qui se mesure — contraste,
 * étiquettes, rôles, ordre des titres, attributs. Il ne dit pas si un parcours
 * a du sens au clavier ni si un texte est compréhensible. C'est un plancher,
 * pas un certificat, et l'écrire évite qu'une suite verte serve d'argument.
 */
const NORMES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Les écrans qu'un visiteur atteint sans compte. */
const PUBLIQUES = [
  { nom: "connexion", url: "/login" },
  { nom: "mot de passe oublié", url: "/forgot" },
  { nom: "état des services", url: "/status" },
];

/** Ceux qui demandent une session, donc une connexion préalable. */
const PRIVEES = [
  { nom: "accueil", url: "/" },
  { nom: "mes serveurs", url: "/servers" },
  { nom: "mon compte", url: "/account" },
  { nom: "sécurité", url: "/account/security" },
];

async function auditer(page: import("@playwright/test").Page, nom: string) {
  const resultat = await new AxeBuilder({ page }).withTags(NORMES).analyze();

  // Le message nomme la règle, la gravité **et l'élément** : un rapport qui
  // dit seulement « 3 violations » oblige à rejouer le test à la main pour
  // savoir où regarder.
  const detail = resultat.violations
    .map(
      (v) =>
        `  [${v.impact ?? "?"}] ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 5)
          .map(
            (n) =>
              `      ${n.target.join(" ")}\n` +
              // Le résumé d'axe porte les **valeurs mesurées** : couleurs,
              // taille de police, rapport obtenu. Sans lui, on lit « contraste
              // insuffisant » sans savoir de combien ni entre quoi et quoi, et
              // il faut rejouer le test à la main pour corriger.
              `        ${(n.failureSummary ?? "").replace(/\n/g, "\n        ")}`,
          )
          .join("\n") +
        (v.nodes.length > 5 ? `\n      … et ${v.nodes.length - 5} autre(s)` : ""),
    )
    .join("\n");

  expect(resultat.violations, `Écran « ${nom} » :\n${detail}`).toEqual([]);
}

test.describe("accessibilité des écrans publics", () => {
  for (const { nom, url } of PUBLIQUES) {
    test(nom, async ({ page }) => {
      await page.goto(url);
      await fermerAvertissement(page);
      await auditer(page, nom);
    });
  }
});

test.describe("accessibilité des écrans du panel", () => {
  // Une seule connexion pour tout le groupe : rejouer le formulaire avant
  // chaque écran mesurerait surtout la vitesse de la page de connexion.
  test.beforeEach(async ({ page }) => {
    await seConnecter(page);
  });

  for (const { nom, url } of PRIVEES) {
    test(nom, async ({ page }) => {
      await page.goto(url);
      await auditer(page, nom);
    });
  }
});

test.describe("navigation au clavier", () => {
  test("la connexion se fait sans souris", async ({ page }) => {
    /*
     * Ce qu'axe ne mesure pas : l'ordre de tabulation et le fait que les
     * champs soient réellement atteignables. Un formulaire parfaitement étiqueté
     * peut rester inutilisable si un élément décoratif capte le focus.
     */
    await page.goto("/login");
    await fermerAvertissement(page);

    await page.locator(CHAMP_EMAIL).focus();
    await page.keyboard.type("quelquun@exemple.fr");
    await page.keyboard.press("Tab");
    await page.keyboard.type("un-mot-de-passe");

    const actif = await page.evaluate(() => document.activeElement?.getAttribute("type"));
    expect(actif, "la tabulation depuis l'adresse doit mener au mot de passe").toBe("password");
  });

  test("un anneau de focus visible accompagne le parcours", async ({ page }) => {
    // Sans indicateur visible, quelqu'un qui navigue au clavier ne sait plus
    // où il est — c'est le critère 2.4.7, et il ne se voit sur aucune capture
    // d'écran statique.
    await page.goto("/login");
    await fermerAvertissement(page);
    await page.keyboard.press("Tab");

    const visible = await page.evaluate(() => {
      const actif = document.activeElement;
      if (!actif || actif === document.body) return false;
      const style = getComputedStyle(actif);
      return style.outlineStyle !== "none" || style.boxShadow !== "none";
    });
    expect(visible).toBe(true);
  });
});
