import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ActivityService } from "../activity/activity.service";
import { AdminGuard } from "../admin/admin.guard";
import { AdminWriteGuard } from "../admin/admin-write.guard";
import { StaffTwoFactorGuard } from "../admin/staff-2fa.guard";
import type { AuthenticatedRequest } from "../auth/session.guard";
import { SessionGuard } from "../auth/session.guard";
import { UpdateService } from "./update.service";

type AdminRequest = AuthenticatedRequest & { ip?: string };

/**
 * Mise à jour autonome, côté administration : l'état, une recherche
 * immédiate, le retour à la version précédente. Chaque geste est consigné.
 *
 * Hors d'un hébergement autonome, l'état dit seulement `actif: false` et
 * l'interface n'affiche rien.
 */
@Controller("api/v1/admin/updates")
@UseGuards(SessionGuard, AdminGuard, StaffTwoFactorGuard)
export class UpdatesAdminController {
  constructor(
    @Inject(UpdateService) private readonly updates: UpdateService,
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}

  @Get()
  status() {
    return { data: this.updates.status() };
  }

  /**
   * Lance une recherche sans l'attendre : une installation dure le temps
   * d'un téléchargement et d'une répétition, l'écran suit l'état.
   */
  @Post("check")
  @UseGuards(AdminWriteGuard)
  async check(@Req() request: AdminRequest) {
    if (!this.updates.enabled) throw new NotFoundException();
    await this.trace(request, "admin.update_check_requested");
    void this.updates.check().catch(() => {});
    return { data: this.updates.status() };
  }

  @Post("rollback")
  @UseGuards(AdminWriteGuard)
  async rollback(@Req() request: AdminRequest) {
    const avant = this.updates.status();
    const apres = this.updates.rollback();
    await this.trace(request, "admin.update_rolled_back", {
      depuis: avant.actif ? avant.enService : null,
      vers: apres.actif ? apres.enService : null,
    });
    return { data: apres };
  }

  private async trace(
    request: AdminRequest,
    event: string,
    properties: Record<string, unknown> = {},
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

/**
 * Signal du workflow de release : « une version vient de paraître ».
 *
 * Sans compte, signé par un secret partagé (`GAMEDASHBOARD_SIGNAL_SECRET`
 * dans api.env, `PANEL_SIGNAL_SECRET` dans les secrets du dépôt). Un signal
 * refusé — mal signé, périmé, ou mise à jour autonome inactive — répond
 * comme une route inconnue. Accepté, il ne fait que hâter la vérification
 * qui aurait eu lieu de toute façon.
 */
@Controller("api/v1/updates")
export class UpdatesSignalController {
  constructor(@Inject(UpdateService) private readonly updates: UpdateService) {}

  @Post("signal")
  @HttpCode(202)
  signal(
    @Headers("x-gamedashboard-timestamp") horodatage: string | undefined,
    @Headers("x-gamedashboard-version") version: string | undefined,
    @Headers("x-gamedashboard-signature") signature: string | undefined,
  ) {
    if (!horodatage || !version || !signature) throw new NotFoundException();
    if (!this.updates.signal(horodatage, version, signature)) throw new NotFoundException();
    return { accepted: true };
  }
}
