import { type Database, resellerBrandings } from "@gamedashboard/db";
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
import { ABANDON_DOMAINE_MS, BrandingService, MAX_DOMAINES_EN_ATTENTE } from "./branding.service";

/**
 * File de l'agent de certificats, contre une vraie base.
 *
 * Un domaine déclaré mais pas encore vérifié n'y figurait pas : l'agent ne lui
 * posait aucun bloc et ses requêtes tombaient sur le `default_server` de nginx.
 * Il y figure désormais, `verified: false` et jamais `pending` (aucun
 * certificat n'est demandé pour un nom non prouvé), dans des bornes : nom
 * valide, ni la plateforme ni ses sous-domaines, pas abandonné, nombre plafonné.
 * Les domaines vérifiés, eux, ne changent pas.
 */
describe.skipIf(!HAS_DATABASE)("File des certificats (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let service: BrandingService;

  const ilYa = (ms: number) => new Date(Date.now() - ms).toISOString();

  async function declarer(domain: string, champs: Partial<typeof resellerBrandings.$inferInsert>) {
    const userId = await seedUser(db);
    await db.insert(resellerBrandings).values({ userId, domain, domainToken: "jeton", ...champs });
    return userId;
  }

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    const settings = new PlatformSettingsService(db);
    await settings.save({ "brand.domain": "game.hebergeur.fr" });
    service = new BrandingService(db, settings);

    await declarer("verifie.revendeur.fr", { domainVerifiedAt: new Date().toISOString() });
    await declarer("servi.revendeur.fr", {
      domainVerifiedAt: new Date().toISOString(),
      certificateIssuedAt: new Date().toISOString(),
      certificateExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
    });

    // Le vrai chemin de déclaration : `setDomain` efface `domainCheckedAt`.
    await service.setDomain(await seedUser(db), "Attente.Revendeur.fr");
    // Déclaré il y a longtemps, mais une vérification récente le garde actif.
    await declarer("retente.revendeur.fr", {
      updatedAt: ilYa(ABANDON_DOMAINE_MS * 2),
      domainCheckedAt: ilYa(60_000),
      domainFailure: "TXT introuvable",
    });
    // Ni déclaré ni retenté depuis plus de trente jours : abandonné.
    await declarer("abandonne.revendeur.fr", {
      updatedAt: ilYa(ABANDON_DOMAINE_MS + 86_400_000),
    });
    // Noms qu'aucun bloc nginx ne doit porter.
    await declarer("pas un domaine", {});
    await declarer("MAJUSCULES.revendeur.fr", {});
    await declarer("game.hebergeur.fr", {});
    await declarer("api.game.hebergeur.fr", {});
    // Sans jeton : pas une déclaration.
    await declarer("sans-jeton.revendeur.fr", { domainToken: null });
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  it("rend les domaines vérifiés comme avant, puis les déclarés non vérifiés", async () => {
    const file = await service.certificateQueue();
    const par = new Map(file.map((ligne) => [ligne.domain, ligne]));

    expect(par.get("verifie.revendeur.fr")).toMatchObject({ verified: true, pending: true });
    expect(par.get("servi.revendeur.fr")).toMatchObject({ verified: true, pending: false });

    const enAttente = file.filter((ligne) => !ligne.verified).map((ligne) => ligne.domain);
    expect(enAttente.sort()).toEqual(["attente.revendeur.fr", "retente.revendeur.fr"]);
    for (const ligne of file.filter((l) => !l.verified)) {
      // Jamais de certificat demandé pour un nom non prouvé.
      expect(ligne).toMatchObject({ pending: false, issuedAt: null, failure: null });
    }
  });

  it("retire un domaine de la liste dès qu'il est retiré ou vérifié", async () => {
    const [ligne] = await db
      .select({ userId: resellerBrandings.userId })
      .from(resellerBrandings)
      .where(eq(resellerBrandings.domain, "attente.revendeur.fr"));
    if (!ligne) throw new Error("déclaration introuvable");

    await db
      .update(resellerBrandings)
      .set({ domainVerifiedAt: new Date().toISOString() })
      .where(eq(resellerBrandings.userId, ligne.userId));
    expect(
      (await service.certificateQueue()).find((l) => l.domain === "attente.revendeur.fr"),
    ).toMatchObject({ verified: true, pending: true });

    await service.setDomain(ligne.userId, "");
    expect(
      (await service.certificateQueue()).some((l) => l.domain === "attente.revendeur.fr"),
    ).toBe(false);
  });

  it("plafonne le nombre de domaines non vérifiés, les plus récents d'abord", async () => {
    for (let i = 0; i <= MAX_DOMAINES_EN_ATTENTE; i++) {
      await declarer(`lot-${i}.revendeur.fr`, { updatedAt: ilYa(1_000 * (i + 120)) });
    }
    const enAttente = (await service.certificateQueue()).filter((l) => !l.verified);
    expect(enAttente).toHaveLength(MAX_DOMAINES_EN_ATTENTE);
    // Sans dépendre des tests précédents : le plus récent du lot reste, le
    // plus ancien sort, et l'ordre va du plus récent au plus ancien.
    expect(enAttente.some((l) => l.domain === "lot-0.revendeur.fr")).toBe(true);
    const lots = enAttente.flatMap((l) => /^lot-(\d+)\./.exec(l.domain)?.[1] ?? []).map(Number);
    expect(lots).toEqual([...lots].sort((a, b) => a - b));
    expect(enAttente.some((l) => l.domain === `lot-${MAX_DOMAINES_EN_ATTENTE}.revendeur.fr`)).toBe(
      false,
    );
  });

  it("oublie le certificat de l'ancien domaine quand le revendeur en change", async () => {
    // Défaut : `setDomain` gardait les dates du certificat précédent, et le
    // nouveau domaine, une fois vérifié, passait pour déjà servi.
    const userId = await declarer("ancien.revendeur.fr", {
      domainVerifiedAt: new Date().toISOString(),
      certificateIssuedAt: new Date().toISOString(),
      certificateExpiresAt: new Date(Date.now() + 80 * 86_400_000).toISOString(),
      certificateAttemptedAt: new Date().toISOString(),
      certificateFailure: "ancien motif",
    });

    await service.setDomain(userId, "nouveau.revendeur.fr");
    await db
      .update(resellerBrandings)
      .set({ domainVerifiedAt: new Date().toISOString() })
      .where(eq(resellerBrandings.userId, userId));

    const ligne = (await service.certificateQueue()).find(
      (l) => l.domain === "nouveau.revendeur.fr",
    );
    expect(ligne).toMatchObject({
      verified: true,
      pending: true,
      issuedAt: null,
      expiresAt: null,
      attemptedAt: null,
      failure: null,
    });
  });
});

if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
