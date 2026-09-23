import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import { ARCHIVE_TYPE, PART_SIZE, S3Service } from "./s3.service";

/**
 * Ce que le compartiment et Wings exigent du panel, sans réseau.
 *
 * Le client S3 est intercepté à l'envoi : les adresses signées, elles, se
 * calculent pour de vrai — la signature ne demande aucune connexion.
 */

function reglages(): PlatformSettingsService {
  const valeurs: Record<string, string | boolean> = {
    "s3.endpoint": "https://s3.exemple.test",
    "s3.region": "gra",
    "s3.bucket": "sauvegardes",
    "s3.accessKey": "cle-d-acces",
    "s3.prefix": "",
    "s3.pathStyle": true,
  };
  return {
    text: async (cle: string) => String(valeurs[cle] ?? ""),
    boolean: async (cle: string) => valeurs[cle] === true,
    secret: async (cle: string) => (cle === "s3.secretKey" ? "cle-secrete" : ""),
  } as unknown as PlatformSettingsService;
}

/**
 * La découpe de Wings, telle qu'il la fait (`generateRemoteRequest`, dans
 * `server/backup/backup_s3.go`) : `part_size` octets par adresse reçue, sauf
 * la dernière, qui prend le reste.
 */
function decoupeDeWings(taille: number, adresses: number, partSize: number): number[] {
  return Array.from({ length: adresses }, (_, i) =>
    i + 1 < adresses ? partSize : taille - i * partSize,
  );
}

/** Chaque partie annoncée existe-t-elle dans le fichier, au moment de l'envoyer ? */
function tenable(taille: number, parties: number[]): boolean {
  let reste = taille;
  for (const partie of parties) {
    if (partie < 0 || partie > reste) return false;
    reste -= partie;
  }
  return reste === 0;
}

describe("S3Service", () => {
  let envoyes: unknown[];

  beforeEach(() => {
    envoyes = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (commande: unknown) => {
      envoyes.push(commande);
      return { UploadId: "depot-1" };
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ouvre le dépôt en application/x-gzip, le seul type que Wings restaure", async () => {
    await new S3Service(reglages()).openUpload("srv/sauvegarde.tar.gz", 1024);

    const [ouverture] = envoyes;
    expect(ouverture).toBeInstanceOf(CreateMultipartUploadCommand);
    expect((ouverture as CreateMultipartUploadCommand).input.ContentType).toBe(ARCHIVE_TYPE);
    expect(ARCHIVE_TYPE).toBe("application/x-gzip");
  });

  it.each([0, 1, PART_SIZE - 1, PART_SIZE, PART_SIZE + 1, 3 * PART_SIZE + 12_345])(
    "signe exactement une adresse par partie (%i octets)",
    async (taille) => {
      const ticket = await new S3Service(reglages()).openUpload("srv/sauvegarde.tar.gz", taille);
      if (!ticket) throw new Error("dépôt non ouvert");

      expect(ticket.parts).toHaveLength(Math.max(1, Math.ceil(taille / PART_SIZE)));
      // Une adresse de trop faisait annoncer à Wings une partie pleine là où il
      // ne restait que la fin du fichier : tout envoi échouait.
      expect(tenable(taille, decoupeDeWings(taille, ticket.parts.length, ticket.partSize))).toBe(
        true,
      );
    },
  );

  it("abandonne le dépôt encore ouvert avant d'effacer l'archive", async () => {
    await new S3Service(reglages()).discard("srv/sauvegarde.tar.gz", "depot-ouvert");
    expect(envoyes.map((commande) => (commande as object).constructor)).toEqual([
      AbortMultipartUploadCommand,
      DeleteObjectCommand,
    ]);

    envoyes = [];
    await new S3Service(reglages()).discard("srv/sauvegarde.tar.gz", null);
    expect(envoyes.map((commande) => (commande as object).constructor)).toEqual([
      DeleteObjectCommand,
    ]);
  });

  it("ne signe aucune empreinte dans les adresses des parties", async () => {
    const ticket = await new S3Service(reglages()).openUpload(
      "srv/sauvegarde.tar.gz",
      PART_SIZE + 1,
    );
    if (!ticket) throw new Error("dépôt non ouvert");

    // Le SDK y signait le CRC32 d'un corps vide : Amazon S3 refusait alors
    // chaque partie, dont les octets ne sont évidemment pas vides.
    for (const adresse of ticket.parts) {
      expect(parametresDEmpreinte(adresse)).toEqual([]);
    }
  });

  it("impose le type de contenu dans le lien que suit Wings pour restaurer", async () => {
    const lien = await new S3Service(reglages()).presignDownload("srv/sauvegarde.tar.gz");
    if (!lien) throw new Error("lien non signé");

    const url = new URL(lien);
    expect(url.searchParams.get("response-content-type")).toBe("application/x-gzip");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(parametresDEmpreinte(lien)).toEqual([]);
  });
});

function parametresDEmpreinte(adresse: string): string[] {
  return [...new URL(adresse).searchParams.keys()].filter((cle) =>
    cle.toLowerCase().includes("checksum"),
  );
}
