import "reflect-metadata";
import type { Database } from "@gamedashboard/db";
import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { RecordInput } from "../activity/activity.service";
import { AdminController } from "../admin/admin.controller";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { BrandImagesService } from "./brand-images.service";
import { BrandingService } from "./branding.service";
import { ResellerController } from "./reseller.controller";

/** Un PNG minimal : la signature suffit au contrôle de type. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ANCIEN = "https://cdn.exemple.fr/ancien.png";
const EXTERNE = "https://cdn.exemple.fr/nouveau.webp";

const idDe = (chemin: string) => chemin.split("/").pop() ?? "";

/**
 * Non-régression : le formulaire de marque renvoyait l'état chargé à
 * l'ouverture de la page, et écrasait le logo envoyé par fichier entre-temps
 * (autre onglet, autre administrateur, envoi encore en vol). `prune` effaçait
 * ensuite l'image. Avec sa « base », le formulaire ne remplace plus une image
 * qu'il n'a pas vue — mais peut toujours poser une adresse ou vider le champ.
 */
describe.skipIf(!HAS_DATABASE)("Bases des images de marque (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let settings: PlatformSettingsService;
  let branding: BrandingService;
  let images: BrandImagesService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    settings = new PlatformSettingsService(db);
    branding = new BrandingService(db, settings);
    images = new BrandImagesService(db, settings, branding);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  /** Ce que le formulaire du revendeur renvoie : l'état chargé, plus une couleur. */
  const formulaire = (logoUrl: string, accent: string) => ({
    name: "Revendeur",
    logoUrl,
    faviconUrl: "",
    accent,
    supportUrl: "",
    termsUrl: "",
    footerText: "",
    loginTagline: "",
    replyTo: "",
  });

  describe("revendeur", () => {
    it("garde le logo envoyé après l'ouverture du formulaire, et enregistre la couleur", async () => {
      const revendeur = await seedUser(db);
      await branding.save(revendeur, formulaire(ANCIEN, ""));

      // Le formulaire est chargé (base = ANCIEN), puis un logo est envoyé.
      const envoye = await images.uploadForReseller(revendeur, "logo", PNG);

      const { overrides, keptImages } = await branding.saveWithBases(
        revendeur,
        formulaire(ANCIEN, "#112233"),
        { logoUrl: ANCIEN, faviconUrl: "" },
      );
      await images.prune(revendeur);

      expect(await images.read(idDe(envoye))).not.toBeNull();
      expect(overrides.logoUrl).toBe(envoye);
      expect(overrides.accent).toBe("#112233");
      expect(keptImages).toEqual(["logoUrl"]);
    });

    it("une base à jour laisse poser une adresse externe, puis vider le champ", async () => {
      const revendeur = await seedUser(db);
      const envoye = await images.uploadForReseller(revendeur, "logo", PNG);

      const externe = await branding.saveWithBases(revendeur, formulaire(EXTERNE, ""), {
        logoUrl: envoye,
      });
      await images.prune(revendeur);
      expect(externe.keptImages).toEqual([]);
      expect(externe.overrides.logoUrl).toBe(EXTERNE);
      expect(await images.read(idDe(envoye))).toBeNull();

      const vide = await branding.saveWithBases(revendeur, formulaire("", ""), {
        logoUrl: EXTERNE,
      });
      expect(vide.keptImages).toEqual([]);
      expect(vide.overrides.logoUrl).toBe("");
    });

    it("sans base, l'enregistrement se comporte comme avant", async () => {
      const revendeur = await seedUser(db);
      await images.uploadForReseller(revendeur, "logo", PNG);

      const { overrides, keptImages } = await branding.saveWithBases(
        revendeur,
        formulaire(ANCIEN, "#445566"),
        {},
      );
      expect(keptImages).toEqual([]);
      expect(overrides.logoUrl).toBe(ANCIEN);
      expect(overrides.accent).toBe("#445566");
    });

    it("à la première écriture, une base non vide est déjà périmée", async () => {
      const revendeur = await seedUser(db);
      const { overrides, keptImages } = await branding.saveWithBases(
        revendeur,
        formulaire(EXTERNE, "#778899"),
        { logoUrl: ANCIEN },
      );
      expect(overrides.logoUrl).toBe("");
      expect(keptImages).toEqual(["logoUrl"]);
      expect(overrides.accent).toBe("#778899");
    });
  });

  describe("plateforme", () => {
    it("garde le logo envoyé après l'ouverture du formulaire, et enregistre la couleur", async () => {
      await settings.save({ "brand.logoUrl": ANCIEN });
      const envoye = await images.uploadForPlatform("logo", PNG);

      const result = await images.savePlatformSettings(
        { "brand.logoUrl": ANCIEN, "brand.accent": "#112233" },
        { "brand.logoUrl": ANCIEN },
      );

      expect(await images.read(idDe(envoye))).not.toBeNull();
      expect(await settings.text("brand.logoUrl")).toBe(envoye);
      expect(await settings.text("brand.accent")).toBe("#112233");
      expect(result.kept).toEqual(["brand.logoUrl"]);
      expect(result.saved).toEqual(["brand.accent"]);
      expect(result.images["brand.logoUrl"]).toBe(envoye);
    });

    it("une base à jour laisse poser une adresse externe, puis vider le champ", async () => {
      const envoye = await images.uploadForPlatform("logo", PNG);

      const externe = await images.savePlatformSettings(
        { "brand.logoUrl": EXTERNE },
        { "brand.logoUrl": envoye },
      );
      expect(externe.kept).toEqual([]);
      expect(await settings.text("brand.logoUrl")).toBe(EXTERNE);
      expect(await images.read(idDe(envoye))).toBeNull();

      const vide = await images.savePlatformSettings(
        { "brand.logoUrl": "" },
        { "brand.logoUrl": EXTERNE },
      );
      expect(vide.kept).toEqual([]);
      expect(await settings.text("brand.logoUrl")).toBe("");
    });

    it("sans base, l'enregistrement se comporte comme avant", async () => {
      const envoye = await images.uploadForPlatform("logo", PNG);

      const result = await images.savePlatformSettings(
        { "brand.logoUrl": ANCIEN, "brand.accent": "#445566" },
        {},
      );
      expect(result.kept).toEqual([]);
      expect(await settings.text("brand.logoUrl")).toBe(ANCIEN);
      expect(await images.read(idDe(envoye))).toBeNull();
    });

    it("ne signale rien quand la valeur reçue est déjà celle en place", async () => {
      // Aligné sur le revendeur : base périmée, mais la valeur envoyée est
      // celle que le serveur sert déjà — rien n'est écarté.
      const envoye = await images.uploadForPlatform("logo", PNG);
      const result = await images.savePlatformSettings(
        { "brand.logoUrl": envoye },
        { "brand.logoUrl": ANCIEN },
      );
      expect(result.kept).toEqual([]);
      expect(await settings.text("brand.logoUrl")).toBe(envoye);

      const revendeur = await seedUser(db);
      const surRevendeur = await images.uploadForReseller(revendeur, "logo", PNG);
      const { keptImages } = await branding.saveWithBases(revendeur, formulaire(surRevendeur, ""), {
        logoUrl: ANCIEN,
      });
      expect(keptImages).toEqual([]);
    });
  });

  /*
   * Au niveau des routes : le corps de la requête porte bien la base jusqu'au
   * service. Sans ce branchement (`brandImageBases(body)` ou
   * `platformImageBases(body)` remplacés par `{}`), les tests de service
   * passeraient encore et le défaut reviendrait.
   */
  describe("routes", () => {
    const requete = (id: string) => ({
      user: { id, email: `${id}@gamedashboard.test`, role: "admin" },
      ip: "203.0.113.7",
      headers: { "user-agent": "vitest" },
    });

    /** Contrôleur construit sans son constructeur : seuls ces services sont en jeu. */
    function controleurs() {
      const record = vi.fn(async (_: RecordInput) => undefined);
      const admin = Object.create(AdminController.prototype) as AdminController;
      Object.assign(admin, {
        platform: settings,
        branding,
        brandImages: images,
        activityLog: { record },
      });
      const revendeur = Object.create(ResellerController.prototype) as ResellerController;
      Object.assign(revendeur, { branding_: branding, images_: images, activity: { record } });
      return { admin, revendeur, journal: () => record.mock.calls.map(([ligne]) => ligne) };
    }

    it("POST /reseller/branding garde le logo envoyé et le consigne", async () => {
      const { revendeur, journal } = controleurs();
      const id = await seedUser(db);
      await branding.save(id, formulaire(ANCIEN, ""));
      const envoye = await images.uploadForReseller(id, "logo", PNG);

      const { data } = await revendeur.saveBranding(requete(id) as never, {
        ...formulaire(ANCIEN, "#112233"),
        imageBases: { logoUrl: ANCIEN, faviconUrl: "" },
      });

      expect(await images.read(idDe(envoye))).not.toBeNull();
      expect(data.logoUrl).toBe(envoye);
      expect(data.accent).toBe("#112233");
      expect(data.keptImages).toEqual(["logoUrl"]);
      expect(journal()).toEqual([
        expect.objectContaining({
          event: "reseller.branding_saved",
          properties: { keptImages: ["logoUrl"] },
        }),
      ]);
    });

    it("POST /admin/settings garde le logo envoyé et le consigne", async () => {
      const { admin, journal } = controleurs();
      await settings.save({ "brand.logoUrl": ANCIEN });
      const envoye = await images.uploadForPlatform("logo", PNG);

      const { data } = await admin.saveSettings(requete("admin-1") as never, {
        values: { "brand.logoUrl": ANCIEN, "brand.accent": "#112233" },
        bases: { "brand.logoUrl": ANCIEN },
      });

      expect(await images.read(idDe(envoye))).not.toBeNull();
      expect(await settings.text("brand.logoUrl")).toBe(envoye);
      expect(await settings.text("brand.accent")).toBe("#112233");
      expect(data.kept).toEqual(["brand.logoUrl"]);
      expect(journal()).toEqual([
        expect.objectContaining({
          event: "admin.settings_saved",
          properties: { keys: ["brand.accent"], values: {}, keptImages: ["brand.logoUrl"] },
        }),
      ]);
    });

    it("consigne une image gardée même quand rien d'autre n'est enregistré", async () => {
      const { admin, journal } = controleurs();
      const envoye = await images.uploadForPlatform("favicon", PNG);
      await admin.saveSettings(requete("admin-1") as never, {
        values: { "brand.faviconUrl": ANCIEN },
        bases: { "brand.faviconUrl": "" },
      });
      expect(await settings.text("brand.faviconUrl")).toBe(envoye);
      expect(journal()).toEqual([
        expect.objectContaining({
          event: "admin.settings_saved",
          properties: { keys: [], values: {}, keptImages: ["brand.faviconUrl"] },
        }),
      ]);
    });

    it("refuse une base qui n'est pas une chaîne, sans rien écrire", async () => {
      const { admin, revendeur } = controleurs();
      const id = await seedUser(db);
      const envoye = await images.uploadForReseller(id, "logo", PNG);
      for (const base of [null, 42, ["x"], { a: 1 }]) {
        await expect(
          revendeur.saveBranding(requete(id) as never, {
            ...formulaire(ANCIEN, "#abcdef"),
            imageBases: { logoUrl: base },
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(
        revendeur.saveBranding(requete(id) as never, {
          ...formulaire(ANCIEN, ""),
          imageBases: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await branding.overridesFor(id)).logoUrl).toBe(envoye);
      expect((await branding.overridesFor(id)).accent).toBe("");

      const plateforme = await images.uploadForPlatform("logo", PNG);
      await expect(
        admin.saveSettings(requete("admin-1") as never, {
          values: { "brand.logoUrl": ANCIEN },
          bases: { "brand.logoUrl": null },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await settings.text("brand.logoUrl")).toBe(plateforme);
    });
  });
});

if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
