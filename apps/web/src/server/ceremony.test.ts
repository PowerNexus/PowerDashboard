import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCeremony } from "@/server/api/sso";
import { finishCeremony } from "@/server/ceremony";

/**
 * Le retour d'une cérémonie OAuth, côté web.
 *
 * C'est ici, et nulle part ailleurs, que `state` est vérifié : la valeur
 * attendue vit dans un cookie que seule la couche web détient, et l'API ne
 * voit pas le navigateur. Une régression passerait donc inaperçue de tous les
 * tests de l'API — et rouvrirait la connexion forcée : un lien de retour
 * portant le code d'autorisation de l'attaquant connecterait la victime à
 * **son** compte.
 *
 * L'API est simulée : ce qui se joue ici se décide avant de l'appeler.
 */

vi.mock("@/server/api/sso", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/api/sso")>()),
  completeCeremony: vi.fn(),
}));

const echange = vi.mocked(completeCeremony);
const PANEL = "https://panel.gamedashboard.test";

/** Le retour du fournisseur, avec le cookie posé au départ de la cérémonie. */
function retour(
  chemin: string,
  cookies: Record<string, unknown> = {
    gd_sso: { state: "etat-de-la-ceremonie", codeVerifier: "verificateur" },
  },
): NextRequest {
  const entete = Object.entries(cookies)
    .map(([nom, valeur]) => {
      const texte = typeof valeur === "string" ? valeur : JSON.stringify(valeur);
      return `${nom}=${encodeURIComponent(texte)}`;
    })
    .join("; ");
  return new NextRequest(`${PANEL}${chemin}`, { headers: entete ? { cookie: entete } : {} });
}

/** Où la réponse renvoie le navigateur, relativement au panel. */
function destination(reponse: Response): string {
  const url = new URL(reponse.headers.get("location") ?? "", PANEL);
  return `${url.pathname}${url.search}`;
}

describe("vérification de state au retour d'une cérémonie", () => {
  beforeEach(() => {
    echange.mockReset();
    echange.mockResolvedValue(Response.json({ user: { id: "compte" } }));
  });

  it("termine la cérémonie dont l'état correspond, avec son vérificateur", async () => {
    const reponse = await finishCeremony(
      "sso",
      retour("/auth/sso/callback?code=code-du-fournisseur&state=etat-de-la-ceremonie"),
    );

    expect(echange).toHaveBeenCalledWith("sso", "code-du-fournisseur", "verificateur");
    expect(destination(reponse)).toBe("/");
  });

  it("refuse un état différent, sans rien échanger", async () => {
    const reponse = await finishCeremony(
      "sso",
      retour("/auth/sso/callback?code=code-de-l-attaquant&state=etat-de-l-attaquant"),
    );

    expect(echange).not.toHaveBeenCalled();
    expect(destination(reponse)).toBe("/login?sso=state");
  });

  it("refuse un retour sans état", async () => {
    const reponse = await finishCeremony("sso", retour("/auth/sso/callback?code=code"));

    expect(echange).not.toHaveBeenCalled();
    expect(destination(reponse)).toBe("/login?sso=failed");
  });

  it("refuse un retour sans cérémonie ouverte dans ce navigateur", async () => {
    // Le cas même de la connexion forcée : la victime n'a rien commencé.
    const reponse = await finishCeremony(
      "sso",
      retour("/auth/sso/callback?code=code&state=etat-de-la-ceremonie", {}),
    );

    expect(echange).not.toHaveBeenCalled();
    expect(destination(reponse)).toBe("/login?sso=expired");
  });

  it("refuse un cookie sans état, même quand l'URL n'en porte pas de vraisemblable", async () => {
    const reponse = await finishCeremony(
      "sso",
      retour("/auth/sso/callback?code=code&state=undefined", {
        gd_sso: { codeVerifier: "verificateur" },
      }),
    );

    expect(echange).not.toHaveBeenCalled();
    expect(destination(reponse)).toBe("/login?sso=state");
  });

  it("refuse un cookie illisible", async () => {
    const reponse = await finishCeremony(
      "sso",
      retour("/auth/sso/callback?code=code&state=etat", { gd_sso: "{pas du json" }),
    );

    expect(echange).not.toHaveBeenCalled();
    expect(destination(reponse)).toBe("/login?sso=expired");
  });

  it("efface le cookie de la cérémonie qui aboutit", async () => {
    const reponse = await finishCeremony(
      "sso",
      retour("/auth/sso/callback?code=code&state=etat-de-la-ceremonie"),
    );

    expect(efface(reponse, "gd_sso", "/auth/sso")).toBe(true);
  });

  it("ne termine pas chez Google une cérémonie ouverte chez l'annuaire", async () => {
    // Chaque cérémonie a son cookie : un état valable pour l'une ne vaut rien
    // pour l'autre.
    const reponse = await finishCeremony(
      "google",
      retour("/auth/google/callback?code=code&state=etat-de-la-ceremonie"),
    );

    expect(echange).not.toHaveBeenCalled();
    expect(destination(reponse)).toBe("/login?sso=expired");
  });
});

/** La réponse efface-t-elle ce cookie, sur son chemin ? */
function efface(reponse: Response, nom: string, chemin: string): boolean {
  return reponse.headers
    .getSetCookie()
    .some(
      (ligne) =>
        ligne.startsWith(`${nom}=;`) &&
        ligne.includes(`Path=${chemin}`) &&
        ligne.includes("Expires=Thu, 01 Jan 1970"),
    );
}

/**
 * Une cérémonie qui échoue ne laisse pas son état derrière elle (NC-26).
 *
 * Le cookie vivait ses dix minutes après un retour refusé : quiconque
 * apprenait l'état — il passe dans l'URL d'autorisation, donc dans
 * l'historique et les journaux du fournisseur — pouvait encore faire terminer
 * au navigateur de la victime une cérémonie portant **son** code, et la
 * connecter à son compte. Seul le succès l'effaçait.
 */
describe("cookie de la cérémonie après un échec", () => {
  const cas: [string, string, Record<string, unknown> | undefined, () => void][] = [
    ["refus du fournisseur", "/auth/sso/callback?error=access_denied&state=x", undefined, () => {}],
    ["retour sans code", "/auth/sso/callback?state=etat-de-la-ceremonie", undefined, () => {}],
    ["état différent", "/auth/sso/callback?code=c&state=autre", undefined, () => {}],
    ["cookie illisible", "/auth/sso/callback?code=c&state=x", { gd_sso: "{pas du json" }, () => {}],
    [
      "échange refusé par l'API",
      "/auth/sso/callback?code=c&state=etat-de-la-ceremonie",
      undefined,
      () => echange.mockResolvedValue(Response.json({ message: "refus" }, { status: 409 })),
    ],
    [
      "API injoignable",
      "/auth/sso/callback?code=c&state=etat-de-la-ceremonie",
      undefined,
      () => echange.mockRejectedValue(new TypeError("fetch failed")),
    ],
  ];

  beforeEach(() => {
    echange.mockReset();
  });

  for (const [nom, chemin, cookies, preparer] of cas) {
    it(`l'efface sur ${nom}`, async () => {
      preparer();
      const reponse = await finishCeremony("sso", retour(chemin, cookies));

      expect(destination(reponse)).toMatch(/^\/login\?sso=/);
      expect(efface(reponse, "gd_sso", "/auth/sso")).toBe(true);
    });
  }

  it("efface celui de Google quand c'est la cérémonie de Google qui échoue", async () => {
    const reponse = await finishCeremony(
      "google",
      retour("/auth/google/callback?code=c&state=autre", {
        gd_google: { state: "etat", codeVerifier: "v" },
      }),
    );

    expect(efface(reponse, "gd_google", "/auth/google")).toBe(true);
  });
});

/**
 * Le retour reste sur le domaine où le navigateur est arrivé.
 *
 * Next bâtit l'URL de la requête sur son adresse d'écoute, pas sur l'hôte
 * demandé : derrière nginx, `https://localhost:3210`. Une redirection
 * construite sur `request.nextUrl.origin` renvoyait le navigateur vers sa
 * propre machine, sans le cookie posé pour le domaine du panel.
 */
describe("domaine du retour", () => {
  /** La requête telle que Next la voit derrière nginx. */
  const derriereNginx = (chemin: string, cookie: string) =>
    new NextRequest(`https://localhost:3210${chemin}`, {
      headers: { host: "panel.gamedashboard.test", cookie },
    });
  const ceremonie = `gd_sso=${encodeURIComponent(
    JSON.stringify({ state: "etat-de-la-ceremonie", codeVerifier: "verificateur" }),
  )}`;

  beforeEach(() => {
    echange.mockReset();
    echange.mockResolvedValue(Response.json({ user: { id: "compte" } }));
  });

  it("renvoie à l'accueil par une adresse relative", async () => {
    const reponse = await finishCeremony(
      "sso",
      derriereNginx("/auth/sso/callback?code=c&state=etat-de-la-ceremonie", ceremonie),
    );

    expect(reponse.headers.get("location")).toBe("/");
  });

  it("renvoie un refus par une adresse relative", async () => {
    const reponse = await finishCeremony(
      "sso",
      derriereNginx("/auth/sso/callback?code=c&state=autre", ceremonie),
    );

    expect(reponse.headers.get("location")).toBe("/login?sso=state");
  });
});
