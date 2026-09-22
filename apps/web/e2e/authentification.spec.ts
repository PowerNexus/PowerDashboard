
import {
  BOUTON_CONNEXION,
  CHAMP_EMAIL,
  CHAMP_MDP,
  COMPTE,
  fermerAvertissement,
  seConnecter,
  expect,
  test,
} from "./fixtures";

/**
 * Le parcours sans lequel rien d'autre n'existe.
 *
 * Il est éprouvé ici et pas seulement par des tests d'API parce que la moitié
 * de ce qui peut casser n'est pas dans l'API : un cookie posé sans l'attribut
 * qu'il faut, une redirection qui boucle, un formulaire qui se soumet deux
 * fois, un rendu serveur qui ne correspond pas à l'hydratation.
 */
test.describe("connexion", () => {
  test("la page se rend et nomme ce qu'elle attend", async ({ page }) => {
    await page.goto("/login");
    await fermerAvertissement(page);

    await expect(page.getByRole("heading", { name: /connexion|sign in/i })).toBeVisible();
    await expect(page.locator(CHAMP_EMAIL)).toBeVisible();
    await expect(page.locator(CHAMP_MDP)).toBeVisible();
  });

  test("un mauvais mot de passe est refusé sans dire lequel des deux est faux", async ({
    page,
  }) => {
    /*
     * **Le message ne doit pas distinguer** « compte inconnu » de « mot de
     * passe faux ». La différence transformerait le formulaire en outil
     * d'énumération : on apprendrait quelles adresses ont un compte ici, ce
     * qui est exactement ce qu'un attaquant cherche d'abord.
     */
    await page.goto("/login");
    await fermerAvertissement(page);

    await page.locator(CHAMP_EMAIL).fill(COMPTE.email);
    await page.locator(CHAMP_MDP).fill("ce-n-est-pas-le-bon");
    await page.locator(BOUTON_CONNEXION).click();

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    // Le message ne doit nommer ni l'adresse ni le mot de passe comme étant
    // la valeur fautive.
    const texte = (await page.getByRole("alert").textContent()) ?? "";
    expect(texte).not.toMatch(/compte (inconnu|introuvable)|unknown account|no such user/i);
  });

  test("une connexion réussie quitte la page de connexion", async ({ page }) => {
    await seConnecter(page);
    /*
     * `main` et non `navigation` : sur un téléphone, la barre latérale est
     * repliée derrière le bouton burger et **aucun** `<nav>` n'est rendu tant
     * qu'on ne l'ouvre pas. Le test passait sur écran large et échouait sur
     * mobile, pour une raison qui n'avait rien à voir avec la connexion.
     *
     * Le contenu principal, lui, existe dans les deux cas : c'est ce qu'on
     * veut dire par « la coquille du panel est là ».
     */
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("une page gardée renvoie vers la connexion", async ({ page }) => {
    // Sans session : la garde doit renvoyer, et non rendre une page vide ou
    // une erreur — c'est la différence entre « il faut se connecter » et
    // « le panel est cassé ».
    await page.context().clearCookies();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
