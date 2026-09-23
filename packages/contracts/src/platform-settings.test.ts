import { describe, expect, it } from "vitest";
import { PLATFORM_BRAND_SETTINGS, PLATFORM_SETTINGS, SETTING_BY_KEY } from "./platform-settings";

describe("marque de la plateforme", () => {
  it("déclare chaque champ de marque d'un revendeur dans le catalogue", () => {
    // La plateforme doit pouvoir régler tout ce qu'un revendeur règle : un
    // champ sans réglage retombait toujours sur le produit, quoi qu'on fasse.
    for (const [champ, clef] of Object.entries(PLATFORM_BRAND_SETTINGS)) {
      const descripteur = SETTING_BY_KEY.get(clef);
      expect(descripteur, `« ${champ} » n'a pas de réglage « ${clef} ».`).toBeDefined();
      expect(descripteur?.kind).toBe("text");
    }
  });

  it("contrôle la forme des adresses et de la couleur", () => {
    const formats = Object.fromEntries(
      Object.values(PLATFORM_BRAND_SETTINGS).map((clef) => [
        clef,
        SETTING_BY_KEY.get(clef)?.format,
      ]),
    );
    expect(formats).toMatchObject({
      "brand.logoUrl": "url",
      "brand.faviconUrl": "url",
      "brand.supportUrl": "url",
      "brand.termsUrl": "url",
      "brand.accent": "hex",
    });
  });
});

/**
 * Les valeurs par défaut des réglages de sécurité, épinglées.
 *
 * Un défaut de sécurité se change en modifiant un seul mot dans une longue
 * liste. Le geste ne se voit pas à la relecture, et la conséquence ne se voit
 * pas non plus : elle ne s'applique qu'aux installations **neuves**, celles
 * que personne ne regarde au moment où on le change.
 *
 * Ce test ne dit pas que ces valeurs sont les bonnes. Il dit qu'en changer une
 * oblige à toucher ce fichier, donc à l'écrire, donc à l'assumer.
 */
describe("défauts des réglages de sécurité", () => {
  const ATTENDUS: Record<string, boolean> = {
    /*
     * Ouvert : verrouiller l'administration d'un panel neuf était le contraire
     * de ce qu'on voulait. Le premier compte est administrateur, il n'a pas
     * encore de seconde preuve, et l'espace qui permet d'en poser une est
     * celui que la règle ferme.
     */
    "security.staffRequires2fa": false,
    /*
     * Fermé : un panel qui s'installe avec sa page d'inscription ouverte au
     * monde est un panel dont le premier compte n'est pas forcément le vôtre.
     */
    "security.registrationOpen": false,
  };

  it.each(Object.entries(ATTENDUS))("« %s » vaut %s à l'installation", (clef, attendu) => {
    const descripteur = SETTING_BY_KEY.get(clef);
    expect(descripteur, `Le réglage « ${clef} » a disparu du catalogue.`).toBeDefined();
    expect(descripteur?.kind).toBe("boolean");
    expect(
      descripteur?.fallback,
      `Le défaut de « ${clef} » a changé. Si c'est voulu, changez-le ici aussi — ` +
        "et regardez ce que cela fait aux installations existantes sans ligne en base.",
    ).toBe(attendu);
  });

  it("explique chaque réglage de sécurité", () => {
    /*
     * Restreint au groupe « sécurité », et non étendu à tout le catalogue.
     *
     * La première version l'exigeait partout et relevait quinze manques :
     * `smtp.host`, `s3.bucket`, `sso.clientId`… Leur libellé dit déjà tout, et
     * leur écrire une phrase n'aurait produit que du remplissage.
     *
     * Ici c'est différent : un interrupteur de sécurité se coche au jugé si
     * rien ne dit ce qu'il ouvre ou ferme, et « au jugé » est exactement ce
     * qu'il faut éviter sur ces cinq-là.
     */
    const securite = PLATFORM_SETTINGS.find((groupe) => groupe.key === "security");
    expect(securite, "Le groupe « sécurité » a disparu du catalogue.").toBeDefined();

    const muets = (securite?.settings ?? [])
      .filter((s) => (s.description ?? "").length < 30)
      .map((s) => s.key);
    expect(
      muets,
      `Ces réglages de sécurité n'expliquent pas ce qu'ils font : ${muets.join(", ")}`,
    ).toEqual([]);
  });
});
