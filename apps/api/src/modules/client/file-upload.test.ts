import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WingsClientService } from "../wings/wings-client.service";
import { FileUploadService, MAX_OPEN_UPLOADS } from "./file-upload.service";

/**
 * Plafond des sessions d'envoi ouvertes.
 *
 * Chaque session garde ses morceaux sur le disque du panel jusqu'à
 * l'assemblage, jusqu'à 5 Gio par fichier, et n'est balayée qu'après six
 * heures d'inactivité. Sans compteur, un seul compte ouvrait autant de
 * sessions qu'il voulait et remplissait le disque du panel. Un vrai dossier
 * temporaire : c'est lui que le service compte.
 */

const SERVEUR = "srv-1";
const AUTRE_SERVEUR = "srv-2";
const CLIENT = "u-1";
const AUTRE_CLIENT = "u-2";

describe("sessions d'envoi ouvertes", () => {
  let racine: string;
  let service: FileUploadService;

  beforeEach(async () => {
    racine = await mkdtemp(join(tmpdir(), "gd-envois-"));
    process.env.UPLOAD_TMP_DIR = racine;
    service = new FileUploadService({} as WingsClientService);
  });

  afterEach(async () => {
    delete process.env.UPLOAD_TMP_DIR;
    await rm(racine, { recursive: true, force: true });
  });

  const ouvrir = (serverId = SERVEUR, userId = CLIENT) =>
    service.open(serverId, userId, { directory: "/", fileName: "monde.zip", size: 1024 });

  it("refuse (409) une session de plus que le plafond, pour ce compte sur ce serveur", async () => {
    for (let i = 0; i < MAX_OPEN_UPLOADS; i++) await ouvrir();

    await expect(ouvrir()).rejects.toBeInstanceOf(ConflictException);
  });

  it("compte par couple compte et serveur, pas pour tout le panel", async () => {
    for (let i = 0; i < MAX_OPEN_UPLOADS; i++) await ouvrir();

    await expect(ouvrir(AUTRE_SERVEUR, CLIENT)).resolves.toBeDefined();
    await expect(ouvrir(SERVEUR, AUTRE_CLIENT)).resolves.toBeDefined();
  });

  it("rend la place d'une session abandonnée", async () => {
    const sessions = [];
    for (let i = 0; i < MAX_OPEN_UPLOADS; i++) sessions.push(await ouvrir());

    await service.discard(sessions[0]?.id ?? "");
    await expect(ouvrir()).resolves.toBeDefined();
  });

  it("ne compte pas une session expirée, que le balayage effacera", async () => {
    const sessions = [];
    for (let i = 0; i < MAX_OPEN_UPLOADS; i++) sessions.push(await ouvrir());

    const septHeures = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await utimes(join(racine, sessions[0]?.id ?? ""), septHeures, septHeures);
    await expect(ouvrir()).resolves.toBeDefined();
  });

  it("tient le plafond face à des ouvertures simultanées", async () => {
    const issues = await Promise.allSettled(
      Array.from({ length: MAX_OPEN_UPLOADS + 3 }, () => ouvrir()),
    );

    expect(issues.filter((issue) => issue.status === "fulfilled")).toHaveLength(MAX_OPEN_UPLOADS);
    for (const issue of issues.filter((i) => i.status === "rejected")) {
      expect((issue as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    }
  });
});
