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
import { ApplicationKeysService } from "./application-keys.service";

const CreateKey = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()),
  allowedIps: z.array(z.string()).optional(),
  expiresInDays: z.number().int().optional(),
  /**
   * Revendeur auquel borner la clé. Absent = toute la plateforme.
   *
   * C'est ce qui permet de remettre une clé à un revendeur pour qu'il branche
   * sa propre boutique, sans lui donner la main sur les clients des autres.
   * Le compte désigné doit avoir le rôle `reseller` : borner une clé à un
   * compte client la rendrait muette, et le découvrir prendrait une heure.
   */
  resellerId: z.string().uuid().optional(),
});

type AdminRequest = AuthenticatedRequest & { ip?: string };

/**
 * Émission des clés applicatives, depuis l'administration.
 *
 * Ces routes vivent sous `/api/v1/admin` et non sous `/api/application` : une
 * clé applicative ne doit jamais pouvoir en émettre une autre. Sans cette
 * séparation, une clé de facturation compromise se fabriquerait une clé aux
 * pleins pouvoirs, et la révoquer ne servirait plus à rien.
 *
 * `AdminWriteGuard` s'y ajoute, qui refuse les clés d'API personnelles :
 * émettre une clé de machine est un geste d'humain connecté.
 */
@Controller("api/v1/admin/application-keys")
@UseGuards(SessionGuard, AdminGuard, StaffTwoFactorGuard)
export class ApplicationKeysController {
  constructor(
    @Inject(ApplicationKeysService) private readonly keys: ApplicationKeysService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  async list() {
    return { data: await this.keys.all() };
  }

  /**
   * Crée une clé et rend le secret **une seule fois**.
   *
   * Il n'est pas relisible ensuite : la base n'en garde qu'un condensat. Une
   * clé égarée se remplace, elle ne se retrouve pas — et c'est la propriété
   * qui fait qu'une fuite de la base ne livre aucune clé utilisable.
   */
  @Post()
  @UseGuards(AdminWriteGuard)
  async create(@Req() request: AdminRequest, @Body() body: unknown) {
    const parsed = CreateKey.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Requête invalide.");
    }

    const created = await this.keys.create(request.user.id, parsed.data);

    await this.activity.record({
      event: "admin.application_key_created",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      // Le secret n'entre pas au journal : un journal est fait pour être relu,
      // exporté et conservé — trois choses qu'on ne veut pas d'un secret.
      properties: { keyId: created.key.id, name: created.key.name, scopes: created.key.scopes },
    });

    return { data: created };
  }

  /**
   * Émet une clé d'amorçage pour la mise en service d'un node.
   *
   * Elle vit sur cette route plutôt que sous `/admin/nodes` parce que ce
   * qu'elle crée est une clé, pas un node : c'est ici que se trouvent le cycle
   * de vie, la révocation et le journal qui vont avec.
   *
   * Le secret est rendu, comme toute création de clé — et comme toute création
   * de clé, il n'entre pas au journal.
   */
  @Post("node/:nodeId")
  @UseGuards(AdminWriteGuard)
  async issueForNode(@Req() request: AdminRequest, @Param("nodeId") nodeId: string) {
    const issued = await this.keys.issueForNode(request.user.id, nodeId);

    await this.activity.record({
      event: "admin.node_bootstrap_key_issued",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { nodeId, expiresAt: issued.expiresAt },
    });

    return { data: issued };
  }

  @Delete(":keyId")
  @UseGuards(AdminWriteGuard)
  async revoke(@Req() request: AdminRequest, @Param("keyId") keyId: string) {
    await this.keys.revoke(keyId);

    await this.activity.record({
      event: "admin.application_key_revoked",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { keyId },
    });

    return { data: { revoked: keyId } };
  }
}
