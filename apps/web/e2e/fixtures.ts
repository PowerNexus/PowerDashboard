import { test as base, expect, type Page } from "@playwright/test";

/**
 * Le test de référence de cette suite : comme celui de Playwright, mais avec
 * l'avertissement de bêta déjà lu.
 *
 * **Pourquoi le neutraliser plutôt que le fermer.** C'est une fenêtre modale :
 * tant qu'elle est ouverte, Radix marque tout le reste de la page
 * `aria-hidden`, et les éléments cessent d'exister pour l'arbre
 * d'accessibilité — donc pour `getByRole`, donc pour axe. Les tests
 * échouaient sur « élément introuvable » un peu partout, sans que rien ne
 * désigne la fenêtre comme la cause.
 *
 * La fermer par un clic marchait, mais laissait une course avec l'animation de
 * sortie. Poser la clé de stockage **avant** la navigation supprime le
 * problème à la racine, et décrit d'ailleurs le cas le plus fréquent :
 * quelqu'un qui a déjà lu l'avertissement.
 *
 * La valeur est celle du composant ; si elle change, l'avertissement
 * reparaîtra et la suite le dira aussitôt.
 */
export const test = base.extend<{ avertissementLu: undefined }>({
  avertissementLu: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        try {
          localStorage.setItem("gd-beta-notice", "1");
        } catch {
          // Stockage refusé : la fenêtre s'affichera, et `fermerAvertissement`
          // reste là pour ce cas.
        }
      });
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Le compte d'essai, créé par la CI avant la suite.
 *
 * Passé par l'environnement plutôt qu'écrit ici : un mot de passe en clair
 * dans un dépôt finit par être essayé ailleurs, et celui-ci ouvre un panel
 * d'administration. Les valeurs par défaut ne servent qu'en local, contre une
 * base jetable.
 */
/**
 * Les deux champs de connexion, désignés par leur `name`.
 *
 * Et non par leur étiquette : « mot de passe » désigne aussi le bouton
 * « Afficher le mot de passe », et Playwright refuse — à raison — un sélecteur
 * qui résout à deux éléments. Le `name` d'un champ est ce que le formulaire
 * envoie : s'il change, la soumission change aussi, donc le test doit changer.
 */
export const CHAMP_EMAIL = 'input[name="email"]';
export const CHAMP_MDP = 'input[name="password"]';

/**
 * Le bouton d'envoi, désigné par son type et non par son libellé.
 *
 * Son texte est traduit, suivi d'une flèche, et change selon l'étape —
 * « Connexion », puis « Vérifier » si un second facteur est demandé. Un
 * sélecteur par nom accessible attend alors indéfiniment un bouton qui existe
 * sous un autre mot, et le test échoue sur un dépassement de délai qui ne dit
 * rien de la cause.
 */
export const BOUTON_CONNEXION = 'form button[type="submit"]';

export const COMPTE = {
  email: process.env.E2E_EMAIL ?? "e2e@gamedashboard.test",
  password: process.env.E2E_PASSWORD ?? "Essai-E2E-2026!motdepasse",
};

/**
 * Ferme l'avertissement de bêta.
 *
 * Il s'affiche une fois par navigateur, et Playwright ouvre un navigateur neuf
 * à chaque test : sans ce geste, la fenêtre couvrirait la page et **tous** les
 * tests échoueraient sur un élément « masqué par un autre élément » — un
 * symptôme qui ne dit rien de sa cause.
 */
export async function fermerAvertissement(page: Page): Promise<void> {
  /*
   * `.first()` : la fenêtre porte **deux** boutons du même nom — celui du
   * pied, et la croix de fermeture, dont le libellé accessible est le même
   * puisque fermer vaut accepter. Sans cela, le sélecteur résout à deux
   * éléments, `isVisible()` lève, le `catch` avale l'erreur et la fenêtre
   * reste ouverte.
   *
   * La conséquence était générale et illisible : Radix marque le reste de la
   * page `aria-hidden` tant qu'une fenêtre modale est ouverte, si bien que
   * **tous** les tests échouaient sur des éléments introuvables ou
   * incliquables — sans que rien ne désigne la fenêtre comme la cause.
   */
  const bouton = page.getByRole("button", { name: /j'ai compris|understood/i }).first();
  if (await bouton.isVisible().catch(() => false)) {
    await bouton.click();
    // On attend que la fenêtre soit partie : cliquer puis enchaîner laisserait
    // le test courir pendant l'animation de fermeture.
    await bouton.waitFor({ state: "hidden" }).catch(() => undefined);
  }
}

/**
 * Se connecte par la vraie page de connexion.
 *
 * Et non en posant le cookie de session directement : c'est justement le
 * trajet formulaire → API → cookie → rendu que ces tests existent pour
 * éprouver. Le raccourci validerait tout sauf la partie fragile.
 */
export async function seConnecter(page: Page): Promise<void> {
  await page.goto("/login");
  await fermerAvertissement(page);

  await page.locator(CHAMP_EMAIL).fill(COMPTE.email);
  await page.locator(CHAMP_MDP).fill(COMPTE.password);
  await page.locator(BOUTON_CONNEXION).click();

  // On attend la page d'arrivée, pas une seconde fixe : une attente au
  // chronomètre passe sur une machine rapide et échoue sur une machine
  // chargée, ce qui rend la suite peu croyable.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}
