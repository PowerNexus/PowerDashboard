import type { Database } from "@gamedashboard/db";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { NotificationsService } from "../notifications/notifications.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import type { ServerInvitesService } from "./server-invites.service";
import { SubusersService } from "./subusers.service";

const SERVER = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";
const ACTOR = "33333333-3333-3333-3333-333333333333";

/**
 * Le service est appelé avec une base simulée dont seules les lectures
 * comptent ici : la règle vérifiée est celle du calcul des permissions
 * accordables, pas celle de la persistance.
 */
function service(rows: { owner: string; actorPermissions?: string[] }) {
  let call = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            call += 1;
            // Premier appel : le propriétaire du serveur. Second : les
            // permissions de l'auteur en tant que sous-utilisateur.
            if (call === 1) return [{ ownerId: rows.owner }];
            return rows.actorPermissions ? [{ permissions: rows.actorPermissions }] : [];
          },
        }),
      }),
    }),
  } as unknown as Database;

  return new SubusersService(
    db,
    { denyWebsocketTokens: vi.fn(async () => {}) } as unknown as WingsClientService,
    { revocableFor: vi.fn(() => []) } as unknown as WingsTokenService,
    // Ce banc n'éprouve que le calcul des droits : la cloche n'y intervient
    // pas, et un émetteur muet suffit.
    { notify: vi.fn(async () => {}) } as unknown as NotificationsService,
    // Idem pour les invitations par courriel : ce banc s'arrête avant
    // l'aiguillage, puisque `grantable` tranche d'abord.
    { create: vi.fn(async () => ({})) } as unknown as ServerInvitesService,
  );
}

/** `grantable` est privé : on l'atteint par la voie qu'empruntent les appels réels. */
function grantable(svc: SubusersService, actorId: string, requested: string[]) {
  return (
    svc as unknown as {
      grantable: (s: string, a: string, r: string[]) => Promise<string[]>;
    }
  ).grantable(SERVER, actorId, requested);
}

describe("permissions accordables", () => {
  it("laisse le propriétaire tout accorder", async () => {
    const svc = service({ owner: OWNER });
    await expect(grantable(svc, OWNER, ["console.read", "files.delete"])).resolves.toEqual([
      "console.read",
      "files.delete",
    ]);
  });

  it("refuse d'accorder une permission que l'auteur n'a pas", async () => {
    // Sans cette règle, « gérer les accès » deviendrait « tout faire » : il
    // suffirait de s'inviter un second compte avec tous les droits.
    const svc = service({
      owner: OWNER,
      actorPermissions: ["subusers.create", "console.read"],
    });

    await expect(grantable(svc, ACTOR, ["console.read", "files.delete"])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("nomme la permission en trop plutôt que de la retirer en silence", async () => {
    const svc = service({ owner: OWNER, actorPermissions: ["subusers.create"] });
    // Un filtrage discret laisserait l'auteur croire qu'il a accordé le droit.
    await expect(grantable(svc, ACTOR, ["power.kill"])).rejects.toThrow(/power\.kill/);
  });

  it("accepte ce que l'auteur possède réellement", async () => {
    const svc = service({
      owner: OWNER,
      actorPermissions: ["subusers.create", "console.read", "console.send"],
    });
    await expect(grantable(svc, ACTOR, ["console.read", "console.send"])).resolves.toEqual([
      "console.read",
      "console.send",
    ]);
  });

  it("refuse une permission qui n'existe pas", async () => {
    // Une chaîne libre stockée telle quelle ne correspondrait à aucune
    // vérification : elle serait cochée à l'écran et sans effet.
    const svc = service({ owner: OWNER });
    await expect(grantable(svc, OWNER, ["console.god-mode"])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("dédoublonne la liste accordée", async () => {
    const svc = service({ owner: OWNER });
    await expect(grantable(svc, OWNER, ["console.read", "console.read"])).resolves.toEqual([
      "console.read",
    ]);
  });

  it("n'accorde rien à un auteur sans aucun droit sur le serveur", async () => {
    const svc = service({ owner: OWNER });
    await expect(grantable(svc, ACTOR, ["console.read"])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
