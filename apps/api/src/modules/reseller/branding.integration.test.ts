import { type Database, resellerBrandings } from "@gamedashboard/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { BrandingService } from "./branding.service";

/**
 * Priorité des marques, contre une vraie base : **le revendeur l'emporte sur
 * son domaine, champ par champ**, et la plateforme comble ce qu'il laisse vide.
 *
 * Les réglages passent par `PlatformSettingsService.save`, c'est-à-dire par
 * le même chemin que l'écran d'administration, contrôles de forme compris.
 */
describe.skipIf(!HAS_DATABASE)("BrandingService (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let settings: PlatformSettingsService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    settings = new PlatformSettingsService(db);

    await settings.save({
      "brand.name": "Hébergeur",
      "brand.logoUrl": "https://cdn.hebergeur.fr/logo.webp",
      "brand.supportUrl": "https://aide.hebergeur.fr",
      "brand.footerText": "© Hébergeur SAS",
    });

    const revendeur = await seedUser(db);
    await db.insert(resellerBrandings).values({
      userId: revendeur,
      name: "Revendeur",
      logoUrl: "https://cdn.revendeur.fr/logo.webp",
      domain: "panel.revendeur.fr",
      domainToken: "jeton",
      domainVerifiedAt: new Date().toISOString(),
    });
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  it("sert la marque de la plateforme sur son propre domaine", async () => {
    const marque = await new BrandingService(db, settings).forHost("game.hebergeur.fr");
    expect(marque).toMatchObject({
      name: "Hébergeur",
      logoUrl: "https://cdn.hebergeur.fr/logo.webp",
      supportUrl: "https://aide.hebergeur.fr",
      resellerId: null,
    });
  });

  it("laisse le revendeur surcharger la plateforme sur son domaine, champ par champ", async () => {
    const marque = await new BrandingService(db, settings).forHost("Panel.Revendeur.fr");
    expect(marque).toMatchObject({
      // Ce que le revendeur a posé l'emporte…
      name: "Revendeur",
      logoUrl: "https://cdn.revendeur.fr/logo.webp",
      faviconUrl: "https://cdn.revendeur.fr/logo.webp",
      // … et ce qu'il a laissé vide vient de la plateforme, pas du produit.
      supportUrl: "https://aide.hebergeur.fr",
      footerText: "© Hébergeur SAS",
    });
    expect(marque.resellerId).not.toBeNull();
  });

  it("refuse d'enregistrer une adresse de marque dangereuse pour la plateforme", async () => {
    await expect(settings.save({ "brand.logoUrl": "javascript:alert(1)" })).rejects.toThrow(
      /https:\/\//,
    );
    await expect(settings.save({ "brand.accent": "red;}body{display:none" })).rejects.toThrow(
      /hexadécimale/,
    );
    // Rien n'a été écrit : le logo enregistré plus haut est toujours servi.
    expect(await settings.text("brand.logoUrl")).toBe("https://cdn.hebergeur.fr/logo.webp");
  });

  it("enregistre l'adresse de réponse d'un revendeur, et refuse ce qui ajouterait un en-tête", async () => {
    const service = new BrandingService(db, settings);
    const revendeur = await seedUser(db);

    await expect(
      service.save(revendeur, { replyTo: "support@revendeur.fr\r\nBcc: tous@exemple.fr" }),
    ).rejects.toThrow("une seule adresse");
    expect((await service.save(revendeur, { replyTo: " support@revendeur.fr " })).replyTo).toBe(
      "support@revendeur.fr",
    );
  });
});

if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
