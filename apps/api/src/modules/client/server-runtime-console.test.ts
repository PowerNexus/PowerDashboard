import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EulaService } from "../marketplace/eula.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import type { FileUploadService } from "./file-upload.service";
import type { ServerAccessService } from "./server-access.service";
import { ServerRuntimeController } from "./server-runtime.controller";

/**
 * Commandes de console : ce qui part au daemon, et ce qui reste au journal.
 *
 * Le contrôleur est construit avec des doublures : ce qui est vérifié tient à
 * ce qui est relayé et consigné, pas à la base.
 */

const SERVEUR = "srv-1";
const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
} as unknown as AuthenticatedRequest & { ip?: string };

function monter() {
  const access = {
    require: vi.fn(async () => ({ isOwner: true })),
    requireOperable: vi.fn(async () => {}),
  };
  const wings = { sendCommand: vi.fn(async () => {}) };
  const activity = {
    record: vi.fn(async (_ligne: unknown) => {}),
    labelFor: vi.fn(async () => "Matheo"),
  };
  const controleur = new ServerRuntimeController(
    access as unknown as ServerAccessService,
    wings as unknown as WingsClientService,
    {} as EulaService,
    {} as WingsTokenService,
    activity as unknown as ActivityService,
    {} as FileUploadService,
  );
  return { controleur, wings, activity };
}

describe("POST command", () => {
  /*
   * Le journal est lisible par `activity.read` (préréglage « lecteur »),
   * conservé un an et exporté en CSV. Un `/login <mot de passe>` (AuthMe) ou
   * un `rcon_password …` y restait en clair.
   */
  it("ne consigne que le premier mot et la longueur du reste, jamais les arguments", async () => {
    const { controleur, wings, activity } = monter();

    await controleur.command(requete, SERVEUR, { command: "login hunter2-secret" });

    // Le daemon reçoit la commande entière : c'est le journal qui se tait.
    expect(wings.sendCommand).toHaveBeenCalledWith(SERVEUR, "login hunter2-secret");
    const consigne = activity.record.mock.calls[0]?.[0] as unknown as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(consigne.event).toBe("server.command");
    expect(consigne.properties).toEqual({ command: "login", argumentsLength: 14 });
    expect(JSON.stringify(consigne)).not.toContain("hunter2");
  });

  it("consigne une commande sans argument telle quelle, avec une longueur nulle", async () => {
    const { controleur, activity } = monter();

    await controleur.command(requete, SERVEUR, { command: "  stop  " });

    const consigne = activity.record.mock.calls[0]?.[0] as unknown as {
      properties: Record<string, unknown>;
    };
    expect(consigne.properties).toEqual({ command: "stop", argumentsLength: 0 });
  });
});
