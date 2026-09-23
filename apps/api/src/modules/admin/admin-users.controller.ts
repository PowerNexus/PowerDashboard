import { AdminUserPatch, UserSuspensionInput } from "@gamedashboard/contracts";
import { Body, Controller, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ActivityService } from "../activity/activity.service";
import { SessionGuard } from "../auth/session.guard";
import { AdminGuard } from "./admin.guard";
import { type AdminRequest, parseBody } from "./admin-input";
import { AdminUsersService } from "./admin-users.service";
import { AdminWriteGuard } from "./admin-write.guard";
import { StaffTwoFactorGuard } from "./staff-2fa.guard";

/**
 * Modification d'un compte depuis l'administration.
 *
 * Contrôleur à part d'`AdminController`, sous le même préfixe et les mêmes
 * gardes : ces trois routes forment un tout — corriger, réinitialiser,
 * suspendre — et chacune est consignée au journal sous le nom de
 * l'administrateur qui agit.
 */
@Controller("api/v1/admin/users")
@UseGuards(SessionGuard, AdminGuard, StaffTwoFactorGuard, AdminWriteGuard)
export class AdminUsersController {
  constructor(
    @Inject(AdminUsersService) private readonly accounts: AdminUsersService,
    @Inject(ActivityService) private readonly activityLog: ActivityService,
  ) {}

  /** Adresse, prénom, nom, langue. Ni rôle ni mot de passe : voir le service. */
  @Post(":userId")
  async update(
    @Req() request: AdminRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const patch = parseBody(AdminUserPatch, body);
    const outcome = await this.accounts.update(userId, patch, request.ip ?? null);

    await this.activityLog.record({
      event: "admin.user_updated",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { userId, ...patch, emailChanged: outcome.emailChanged },
    });

    return { data: outcome };
  }

  /**
   * Envoie au titulaire un lien de réinitialisation.
   *
   * L'administrateur ne reçoit rien d'autre que l'adresse à laquelle le lien
   * est parti : ni jeton, ni mot de passe. C'est la garantie qu'il ne connaît
   * jamais le secret d'un autre.
   */
  @Post(":userId/password-reset")
  async passwordReset(@Req() request: AdminRequest, @Param("userId") userId: string) {
    const sent = await this.accounts.requestPasswordReset(userId, request.ip ?? null);

    await this.activityLog.record({
      event: "admin.user_password_reset_sent",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { userId, account: sent.sentTo },
    });

    return { data: sent };
  }

  /** Suspend (`suspended: true`, motif exigé) ou réactive un compte. */
  @Post(":userId/suspend")
  async suspend(
    @Req() request: AdminRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(UserSuspensionInput, body);
    const outcome = await this.accounts.setSuspended(request.user.id, userId, input);

    const trace = {
      serverId: null,
      actorId: request.user.id,
      actorType: "user" as const,
      actorLabel: request.user.email,
      ip: request.ip ?? null,
    };
    if (input.suspended) {
      await this.activityLog.record({
        ...trace,
        event: "admin.user_suspended",
        properties: {
          userId,
          account: outcome.email,
          reason: input.reason,
          revokedSessions: outcome.revokedSessions,
        },
      });
    } else {
      await this.activityLog.record({
        ...trace,
        event: "admin.user_unsuspended",
        properties: { userId, account: outcome.email },
      });
    }

    return { data: outcome };
  }
}
