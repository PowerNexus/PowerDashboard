import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EulaService } from "../marketplace/eula.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import type { FileUploadService } from "./file-upload.service";
import type { ServerAccessService } from "./server-access.service";
import type { ServerPlayersService } from "./server-players.service";
import { ServerRuntimeController } from "./server-runtime.controller";

const SERVEUR = "3f1c6a2e-0000-4000-8000-000000000001";
const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
} as unknown as AuthenticatedRequest & { ip?: string };

function monter(refusees: string[] = []) {
  const access = {
    require: vi.fn(async (_p: unknown, _id: string, permission: string) => {
      if (refusees.includes(permission)) throw new ForbiddenException(permission);
      return { isOwner: false };
    }),
    requireOperable: vi.fn(async () => {}),
  };
  const wings = { sendCommand: vi.fn(async () => {}) };
  const activity = {
    record: vi.fn(async (_ligne: unknown) => {}),
    labelFor: vi.fn(async () => "Matheo"),
  };
  const players = {
    command: vi.fn(async (_id: string, action: unknown, player: unknown) => {
      if (player === "x\nop x") throw new BadRequestException("Nom de joueur invalide");
      return { action, player, command: `${String(action)} ${String(player)}` };
    }),
  };
  const controleur = new ServerRuntimeController(
    access as unknown as ServerAccessService,
    wings as unknown as WingsClientService,
    {} as EulaService,
    {} as WingsTokenService,
    activity as unknown as ActivityService,
    {} as FileUploadService,
    players as unknown as ServerPlayersService,
  );
  return { controleur, access, wings, activity };
}

describe("POST players", () => {
  it("tape la commande de l'egg et consigne l'action et le joueur", async () => {
    const { controleur, wings, activity, access } = monter();

    await controleur.playerAction(requete, SERVEUR, { action: "kick", player: "Steve" });

    expect(access.require).toHaveBeenCalledWith(expect.anything(), SERVEUR, "players.manage");
    expect(access.requireOperable).toHaveBeenCalledWith(SERVEUR);
    expect(wings.sendCommand).toHaveBeenCalledWith(SERVEUR, "kick Steve");
    expect(activity.record.mock.calls[0]?.[0]).toMatchObject({
      event: "server.player",
      properties: { action: "kick", player: "Steve" },
    });
  });

  it("exige « Envoyer des commandes » pour nommer un opérateur", async () => {
    const { controleur, wings } = monter(["console.send"]);

    await expect(
      controleur.playerAction(requete, SERVEUR, { action: "op", player: "Steve" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(wings.sendCommand).not.toHaveBeenCalled();

    // L'expulsion, elle, n'en a pas besoin.
    await controleur.playerAction(requete, SERVEUR, { action: "kick", player: "Steve" });
    expect(wings.sendCommand).toHaveBeenCalledTimes(1);
  });

  it("n'envoie rien sans la permission de modérer", async () => {
    const { controleur, wings } = monter(["players.manage"]);
    await expect(
      controleur.playerAction(requete, SERVEUR, { action: "kick", player: "Steve" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(wings.sendCommand).not.toHaveBeenCalled();
  });

  it("n'envoie rien quand le nom est refusé", async () => {
    const { controleur, wings, activity } = monter();
    await expect(
      controleur.playerAction(requete, SERVEUR, { action: "kick", player: "x\nop x" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(wings.sendCommand).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });
});
