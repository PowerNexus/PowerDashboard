import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EulaService } from "../marketplace/eula.service";
import { type WingsClientService, WingsUnavailableError } from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import type { FileUploadService } from "./file-upload.service";
import type { ServerAccessService } from "./server-access.service";
import { ServerRuntimeController } from "./server-runtime.controller";

/**
 * Routes du gestionnaire de fichiers : permission d'abord, relais ensuite.
 *
 * Le contrôleur est construit avec des doublures : ce qui est vérifié tient à
 * l'ordre des appels et à ce qui part vers le daemon, pas à la base.
 */

const SERVEUR = "srv-1";
const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
} as unknown as AuthenticatedRequest & { ip?: string };

function monter(options: { refuse?: boolean; wings?: Partial<WingsClientService> } = {}) {
  const access = {
    require: vi.fn(async (_p: unknown, _id: string, permission: string) => {
      if (options.refuse) throw new ForbiddenException(`Permission « ${permission} » manquante.`);
      return { isOwner: false };
    }),
    requireOperable: vi.fn(async () => {}),
  };
  const wings = {
    chmodFiles: vi.fn(async () => {}),
    renameFile: vi.fn(async () => {}),
    ...options.wings,
  };
  const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Matheo") };
  const controleur = new ServerRuntimeController(
    access as unknown as ServerAccessService,
    wings as unknown as WingsClientService,
    {} as EulaService,
    {} as WingsTokenService,
    activity as unknown as ActivityService,
    {} as FileUploadService,
  );
  return { controleur, access, wings, activity };
}

describe("POST files/chmod", () => {
  const corps = { root: "/", files: [{ file: "start.sh", mode: "755" }] };

  it("exige files.write, et le serveur opérable, avant de relayer", async () => {
    const { controleur, access, wings } = monter();
    await controleur.chmodFiles(requete, SERVEUR, corps);
    expect(access.require).toHaveBeenCalledWith(expect.anything(), SERVEUR, "files.write");
    expect(access.requireOperable).toHaveBeenCalledWith(SERVEUR);
    expect(wings.chmodFiles).toHaveBeenCalledWith(SERVEUR, "/", corps.files);
  });

  it("ne relaie rien sans la permission", async () => {
    const { controleur, wings, activity } = monter({ refuse: true });
    await expect(controleur.chmodFiles(requete, SERVEUR, corps)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(wings.chmodFiles).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it("refuse setuid avant même de consulter les droits", async () => {
    const { controleur, access, wings } = monter();
    await expect(
      controleur.chmodFiles(requete, SERVEUR, { root: "/", files: [{ file: "a", mode: "4755" }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(access.require).not.toHaveBeenCalled();
    expect(wings.chmodFiles).not.toHaveBeenCalled();
  });

  it("consigne le changement au journal d'activité", async () => {
    const { controleur, activity } = monter();
    await controleur.chmodFiles(requete, SERVEUR, corps);
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "files.chmod",
        serverId: SERVEUR,
        properties: { root: "/", files: corps.files },
      }),
    );
  });

  it("rend un node muet en 503", async () => {
    const { controleur } = monter({
      wings: {
        chmodFiles: vi.fn(async () => {
          throw new WingsUnavailableError("N1", "délai dépassé");
        }),
      },
    });
    await expect(controleur.chmodFiles(requete, SERVEUR, corps)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe("POST files/rename", () => {
  it("refuse une cible vide ou terminée par « / »", async () => {
    const { controleur, wings } = monter();
    for (const to of ["", "  ", "plugins/"]) {
      await expect(
        controleur.renameFile(requete, SERVEUR, { root: "/", from: "a.jar", to }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(wings.renameFile).not.toHaveBeenCalled();
  });

  it("exige files.write et relaie un déplacement relatif", async () => {
    const { controleur, access, wings } = monter();
    await controleur.renameFile(requete, SERVEUR, {
      root: "/",
      from: "a.jar",
      to: "plugins/a.jar",
    });
    expect(access.require).toHaveBeenCalledWith(expect.anything(), SERVEUR, "files.write");
    expect(wings.renameFile).toHaveBeenCalledWith(SERVEUR, "/", "a.jar", "plugins/a.jar");
  });

  it("rend une collision lisible, en 409", async () => {
    // Le daemon répond 400 avec une phrase anglaise ; l'écran doit pouvoir
    // dire « ce nom est pris » sans la lire.
    const { controleur } = monter({
      wings: {
        renameFile: vi.fn(async () => {
          throw new WingsUnavailableError(
            "N1",
            "HTTP 400",
            400,
            "Cannot move or rename file, destination already exists.",
          );
        }),
      },
    });
    const erreur = await controleur
      .renameFile(requete, SERVEUR, { root: "/", from: "a", to: "b" })
      .catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ConflictException);
    expect((erreur as ConflictException).message).toContain("« b »");
  });
});
