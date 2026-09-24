import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { ActivityService } from "../activity/activity.service";
import { AdminGuard } from "../admin/admin.guard";
import { AdminWriteGuard } from "../admin/admin-write.guard";
import { StaffTwoFactorGuard } from "../admin/staff-2fa.guard";
import type { AuthenticatedRequest } from "../auth/session.guard";
import { SessionGuard } from "../auth/session.guard";
import { WebhookRegistryService } from "../webhooks/webhook-registry.service";

const CreateWebhook = z.object({
  applicationKeyId: z.string().min(1),
  url: z.string().min(1),
  events: z.array(z.string()),
});

const SetActive = z.object({ active: z.boolean() });

type AdminRequest = AuthenticatedRequest & { ip?: string };

/**
 * Déclaration des rappels sortants, depuis l'administration.
 *
 * Sous `/api/v1/admin` et non sous `/api/v1/application`, pour la même raison
 * que l'émission des clés : une clé applicative ne doit pas pouvoir déclarer
 * où le panel enverra ses rappels. Sans cette séparation, une clé compromise
 * détournerait vers un serveur tiers le flux de tout ce qui se passe sur la
 * plateforme — qui commande, qui résilie, qui est suspendu.
 */
@Controller("api/v1/admin/webhooks")
@UseGuards(SessionGuard, AdminGuard, StaffTwoFactorGuard)
export class WebhooksController {
  constructor(
    @Inject(WebhookRegistryService) private readonly registry: WebhookRegistryService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  async list() {
    return { data: await this.registry.all() };
  }

  /**
   * Dernières livraisons, réussies comme échouées.
   *
   * C'est l'écran de diagnostic : sans lui, une intégration muette se
   * diagnostique en lisant les journaux du processus, c'est-à-dire pas du tout.
   */
  @Get("deliveries")
  async deliveries() {
    return { data: await this.registry.deliveries() };
  }

  /** Crée un point d'entrée et rend son secret de signature, une seule fois. */
  @Post()
  @UseGuards(AdminWriteGuard)
  async create(@Req() request: AdminRequest, @Body() body: unknown) {
    const parsed = CreateWebhook.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Requête invalide.");
    }

    const created = await this.registry.create(parsed.data);

    await this.activity.record({
      event: "admin.webhook_created",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      // L'URL est journalisée, le secret non : un journal est fait pour être
      // relu, exporté et conservé.
      properties: {
        webhookId: created.webhook.id,
        url: parsed.data.url,
        events: parsed.data.events,
      },
    });

    return { data: created };
  }

  @Post(":webhookId/secret")
  @UseGuards(AdminWriteGuard)
  async rotate(@Req() request: AdminRequest, @Param("webhookId") webhookId: string) {
    const rotated = await this.registry.rotateSecret(webhookId);

    await this.activity.record({
      event: "admin.webhook_secret_rotated",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { webhookId },
    });

    return { data: rotated };
  }

  @Post(":webhookId/active")
  @UseGuards(AdminWriteGuard)
  async setActive(
    @Req() request: AdminRequest,
    @Param("webhookId") webhookId: string,
    @Body() body: unknown,
  ) {
    const parsed = SetActive.safeParse(body);
    if (!parsed.success) throw new BadRequestException("État manquant.");

    await this.registry.setActive(webhookId, parsed.data.active);

    // Couper un rappel, c'est rendre la boutique sourde à ce qui se passe :
    // qui l'a fait se consigne comme la création et la suppression.
    await this.activity.record({
      event: "admin.webhook_active_set",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { webhookId, active: parsed.data.active },
    });

    return { data: { webhookId, active: parsed.data.active } };
  }

  @Delete(":webhookId")
  @UseGuards(AdminWriteGuard)
  async remove(@Req() request: AdminRequest, @Param("webhookId") webhookId: string) {
    await this.registry.remove(webhookId);

    await this.activity.record({
      event: "admin.webhook_deleted",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { webhookId },
    });

    return { data: { deleted: webhookId } };
  }
}
