import { brandImages, type Database, resellerBrandings } from "@gamedashboard/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { BrandImagesService } from "./brand-images.service";
import { BrandingService } from "./branding.service";

/** Un PNG minimal : la signature suffit au contrôle de type. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]);

/**
 * Logo et favicon envoyés par fichier, contre une vraie base : l'image est
 * rangée, servie telle quelle, appliquée aussitôt à la marque, et l'ancienne
 * disparaît quand plus rien ne la désigne.
 */
describe.skipIf(!HAS_DATABASE)("BrandImagesService (intégration)", () => {
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

  it("range le logo d'un revendeur, le sert sur son domaine, et efface l'ancien", async () => {
    const revendeur = await seedUser(db);
    await db.insert(resellerBrandings).values({
      userId: revendeur,
      domain: "panel.envoi.fr",
      domainToken: "jeton",
      domainVerifiedAt: new Date().toISOString(),
    });

    const premier = await images.uploadForReseller(revendeur, "logo", PNG);
    expect(premier).toMatch(/^\/brand\/fichier\/[0-9a-f-]{36}$/);
    expect((await branding.forHost("panel.envoi.fr")).logoUrl).toBe(premier);

    const id = premier.split("/").pop() ?? "";
    const lu = await images.read(id);
    expect(lu?.contentType).toBe("image/png");
    expect(Buffer.compare(lu?.bytes ?? Buffer.alloc(0), PNG)).toBe(0);
    expect(lu?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const second = await images.uploadForReseller(revendeur, "logo", PNG);
    expect(second).not.toBe(premier);
    expect(await images.read(id)).toBeNull();

    // Le favicon s'ajoute sans chasser le logo que le champ désigne encore.
    const favicon = await images.uploadForReseller(revendeur, "favicon", ICO);
    const restantes = await db
      .select({ id: brandImages.id })
      .from(brandImages)
      .where(eq(brandImages.resellerId, revendeur));
    expect(restantes.map((r) => `/brand/fichier/${r.id}`).sort()).toEqual([second, favicon].sort());

    // Un champ vidé libère son image à l'enregistrement suivant.
    await branding.save(revendeur, { logoUrl: "", faviconUrl: favicon });
    await images.prune(revendeur);
    expect(await images.read(second.split("/").pop() ?? "")).toBeNull();
    expect(await images.read(favicon.split("/").pop() ?? "")).not.toBeNull();
  });

  it("garde le logo et le favicon envoyés en même temps", async () => {
    // Non-régression : le nettoyage d'un envoi effaçait l'image de l'autre,
    // rangée mais pas encore inscrite dans la marque (404 sur le favicon).
    const revendeur = await seedUser(db);
    for (let tour = 0; tour < 50; tour += 1) {
      const [logo, favicon] = await Promise.all([
        images.uploadForReseller(revendeur, "logo", PNG),
        images.uploadForReseller(revendeur, "favicon", ICO),
      ]);
      expect(await images.read(logo.split("/").pop() ?? "")).not.toBeNull();
      expect(await images.read(favicon.split("/").pop() ?? "")).not.toBeNull();
    }

    for (let tour = 0; tour < 50; tour += 1) {
      const [logo, favicon] = await Promise.all([
        images.uploadForPlatform("logo", PNG),
        images.uploadForPlatform("favicon", ICO),
      ]);
      expect(await images.read(logo.split("/").pop() ?? "")).not.toBeNull();
      expect(await images.read(favicon.split("/").pop() ?? "")).not.toBeNull();
    }
  });

  it("refuse un SVG, même annoncé comme image, et n'écrit rien", async () => {
    const revendeur = await seedUser(db);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(images.uploadForReseller(revendeur, "logo", svg)).rejects.toThrow(/pas de SVG/);
    const lignes = await db
      .select({ id: brandImages.id })
      .from(brandImages)
      .where(eq(brandImages.resellerId, revendeur));
    expect(lignes).toEqual([]);
  });

  it("applique le logo de la plateforme à ses réglages, sans toucher aux revendeurs", async () => {
    const chemin = await images.uploadForPlatform("logo", PNG);
    expect(await settings.text("brand.logoUrl")).toBe(chemin);
    expect((await branding.forHost("game.plateforme.fr")).logoUrl).toBe(chemin);
    // Le revendeur du premier test garde son propre favicon.
    expect((await branding.forHost("panel.envoi.fr")).faviconUrl).toMatch(/^\/brand\/fichier\//);
  });

  it("ne sert rien pour un identifiant malformé ou inconnu", async () => {
    expect(await images.read("../../etc/passwd")).toBeNull();
    expect(await images.read("0b6f2c1e-4a8d-4c52-9d0e-7a1b2c3d4e5f")).toBeNull();
  });
});

if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
