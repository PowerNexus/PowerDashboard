import {
  BadRequestException,
  Body,
  Controller,
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
import { IncidentsService } from "./incidents.service";

const OpenIncident = z.object({
  title: z.string().min(1),
  impact: z.string().min(1),
  nodeIds: z.array(z.string()).optional(),
  body: z.string().min(1),
});

const PostUpdate = z.object({
  state: z.string().min(1),
  body: z.string().min(1),
});

type AdminRequest = AuthenticatedRequest & { ip?: string };

/**
 * Rédaction des incidents, depuis l'administration.
 *
 * Séparé du contrôleur public, qui n'a aucune garde : l'un se lit sans compte,
 * l'autre s'écrit avec. Les fondre dans un même contrôleur ferait dépendre la
 * lecture publique d'une garde posée pour l'écriture — et un oubli dans un sens
 * fermerait la page au public, dans l'autre l'ouvrirait à la rédaction.
 */
@Controller("api/v1/admin/incidents")
@UseGuards(SessionGuard, AdminGuard, StaffTwoFactorGuard)
export class IncidentsController {
  constructor(
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  async list() {
    return { data: await this.incidents.all() };
  }

  @Post()
  @UseGuards(AdminWriteGuard)
  async open(@Req() request: AdminRequest, @Body() body: unknown) {
    const parsed = OpenIncident.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Requête invalide.");
    }

    const incident = await this.incidents.open({
      title: parsed.data.title,
      impact: parsed.data.impact,
      nodeIds: parsed.data.nodeIds ?? [],
      body: parsed.data.body,
    });

    await this.trace(request, "admin.incident_opened", {
      incidentId: incident.id,
      title: incident.title,
      impact: incident.impact,
    });

    return { data: incident };
  }

  @Post(":incidentId/updates")
  @UseGuards(AdminWriteGuard)
  async update(
    @Req() request: AdminRequest,
    @Param("incidentId") incidentId: string,
    @Body() body: unknown,
  ) {
    const parsed = PostUpdate.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Requête invalide.");
    }

    const incident = await this.incidents.update(incidentId, parsed.data);

    await this.trace(request, "admin.incident_updated", {
      incidentId,
      state: incident.state,
    });

    return { data: incident };
  }

  /**
   * Toute publication est tracée.
   *
   * Un incident est un texte public, écrit au nom de la plateforme, au moment
   * où les clients sont le plus attentifs. Savoir qui l'a publié n'est pas un
   * détail d'audit : c'est la première question posée si le texte était faux.
   */
  private async trace(
    request: AdminRequest,
    event: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    await this.activity.record({
      event,
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties,
    });
  }
}
