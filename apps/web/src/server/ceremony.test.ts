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
