
import { expect, fermerAvertissement, test } from "./fixtures";

/**
 * Ce que le panel promet **avant** toute connexion.
 *
 * La coquille installable, la spécification de l'API et la page d'état sont
 * les trois choses qu'un visiteur ou un outil atteint sans compte. Chacune est
 * servie par un chemin différent — un manifeste calculé, une route d'API
 * exposée par le serveur web, une lecture publique — et chacune s'est déjà
 * cassée sans que rien d'autre ne s'en aperçoive.
 */
test.describe("application installable", () => {
  test("le manifeste est servi et complet", async ({ request, page }) => {
    // Lié depuis la page : un manifeste servi mais non référencé n'installe
    // rien, et c'est invisible autrement qu'en lisant le HTML.
    await page.goto("/login");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      /manifest\.webmanifest/,
    );

    const reponse = await request.get("/manifest.webmanifest");
    expect(reponse.status()).toBe(200);

    const manifeste = (await reponse.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };

    expect(manifeste.name).toBeTruthy();
    expect(manifeste.start_url).toBe("/");
    // `standalone` : c'est cette valeur, et elle seule, qui fait proposer
    // l'installation plutôt qu'un simple raccourci.
    expect(manifeste.display).toBe("standalone");

    // Les deux tailles que les navigateurs exigent pour proposer
    // l'installation. Une seule manquante, et la proposition n'apparaît pas —
    // sans message, ni dans la page ni dans la console.
    const tailles = manifeste.icons.map((icone) => icone.sizes);
    expect(tailles).toContain("192x192");
    expect(tailles).toContain("512x512");
    expect(manifeste.icons.some((icone) => icone.purpose === "maskable")).toBe(true);
  });

  test("les icônes sont de vraies images carrées aux tailles annoncées", async ({ request }) => {
    /*
     * **Le contrôle qui compte vraiment.** Un manifeste peut déclarer
     * « 512x512 » et pointer une image de 80 pixels : le navigateur refuse
     * alors l'installation en silence. On lit donc l'en-tête PNG — largeur et
     * hauteur sont aux octets 16 à 24 — plutôt que de croire la déclaration.
     */
    for (const cote of [192, 512]) {
      const reponse = await request.get(`/brand/icon/${cote}`);
      expect(reponse.status(), `icône ${cote}`).toBe(200);
      expect(reponse.headers()["content-type"]).toContain("image/png");

      const octets = await reponse.body();
      const largeur = octets.readUInt32BE(16);
      const hauteur = octets.readUInt32BE(20);
      expect({ largeur, hauteur }).toEqual({ largeur: cote, hauteur: cote });
    }
  });

  test("l'agent de service est servi et ne met aucune page en cache", async ({ request }) => {
    const reponse = await request.get("/sw.js");
    expect(reponse.status()).toBe(200);

    const source = await reponse.text();
    /*
     * Un panel authentifié ne doit rien resservir à qui vient après. Ce
     * contrôle est grossier — il lit le texte — et c'est assumé : il ne prouve
     * pas l'absence de cache, il empêche qu'on en ajoute un par distraction.
     */
    expect(source).toContain("/_next/static/");
    expect(source).not.toMatch(/cache\.put\([^)]*navigate/);
  });

  test("la page hors ligne se rend sans réseau ni session", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/offline");
    await expect(page.getByText(/hors ligne|offline/i).first()).toBeVisible();
  });
});

test.describe("surface publique", () => {
  test("la spécification OpenAPI est lisible sans compte", async ({ request }) => {
    const reponse = await request.get("/api/v1/openapi.json");
    // Servie par l'API, que le serveur web expose sur ce seul chemin. En
    // développement, Next ne relaie pas : le test s'abstient alors plutôt que
    // d'accuser l'API d'une panne qui n'est pas la sienne.
    test.skip(reponse.status() === 404, "OpenAPI non exposée dans cet environnement.");

    const document = (await reponse.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).length).toBeGreaterThan(20);
  });

  test("la page d'état répond sans session", async ({ page, context }) => {
    // Elle est lue par quelqu'un qui n'arrive plus à se connecter : exiger un
    // compte en ferait une page utile uniquement quand on n'en a pas besoin.
    await context.clearCookies();
    await page.goto("/status");
    await fermerAvertissement(page);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  test("une page inconnue rend un écran, pas une erreur brute", async ({ page }) => {
    const reponse = await page.goto("/cette-page-n-existe-pas");
    expect(reponse?.status()).toBe(404);
    await expect(page.getByText(/introuvable|not found/i).first()).toBeVisible();
  });
});
