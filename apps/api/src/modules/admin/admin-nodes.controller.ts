import {
  AllocationRemovalInput,
  NodeBindingInput,
  NodeSettingsInput,
} from "@gamedashboard/contracts";
import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ActivityService } from "../activity/activity.service";
import { SessionGuard } from "../auth/session.guard";
import { AdminGuard } from "./admin.guard";
import { type AdminRequest, parseBody } from "./admin-input";
import { AdminWriteGuard } from "./admin-write.guard";
import { InfrastructureService } from "./infrastructure.service";
import { NodeConfigurationService, type RebindOutcome } from "./node-configuration.service";
import { StaffTwoFactorGuard } from "./staff-2fa.guard";

/**
 * Fiche d'un node : lecture, modification, stock de ports.
 *
 * Contrôleur à part d'`AdminController`, sous le même préfixe et les mêmes
 * gardes. La lecture reste ouverte au support ; toute écriture exige le rôle
 * administrateur, comme partout ailleurs.
 */
@Controller("api/v1/admin/nodes")
@UseGuards(SessionGuard, AdminGuard, StaffTwoFactorGuard)
export class AdminNodesController {
  constructor(
    @Inject(InfrastructureService) private readonly infrastructure: InfrastructureService,
    @Inject(NodeConfigurationService) private readonly nodeConfig: NodeConfigurationService,
    @Inject(ActivityService) private readonly activityLog: ActivityService,
  ) {}

  @Get(":nodeId")
  async detail(@Param("nodeId") nodeId: string) {
    return { data: await this.infrastructure.nodeDetail(nodeId) };
  }

  /**
   * Réglages qui ne concernent que le panel : nom, localisation, classement,
   * capacité, visibilité. Une baisse de capacité sous ce qui est promis aux
   * serveurs est refusée, chiffres à l'appui.
   */
  @Post(":nodeId/settings")
  @UseGuards(AdminWriteGuard)
  async updateSettings(
    @Req() request: AdminRequest,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(NodeSettingsInput, body);
    await this.infrastructure.updateNodeSettings(nodeId, input);

    await this.activityLog.record({
      event: "node.settings_updated",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { nodeId, ...input },
    });

    return { data: { nodeId } };
  }

  /**
   * Adresse, protocole et ports : ce qui vit aussi dans le `config.yml` de la
   * machine. N'est enregistré qu'une fois le daemon joint à la nouvelle
   * adresse — voir `NodeConfigurationService.rebind`.
   *
   * Répond 200 dans tous les cas où la requête était valable : « Wings doit
   * redémarrer » et « le daemon n'a pas pu être joint » sont des issues
   * ordinaires de cette opération, que l'écran explique, pas des pannes.
   */
  @Post(":nodeId/binding")
  @UseGuards(AdminWriteGuard)
  async updateBinding(
    @Req() request: AdminRequest,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const target = parseBody(NodeBindingInput, body);
    const outcome = await this.nodeConfig.rebind(nodeId, target);
    await this.traceBinding(request, nodeId, target, outcome);
    return { data: outcome };
  }

  /**
   * Chaque issue a sa ligne, nommée en toutes lettres : c'est ce qu'on relit
   * quand un node devient injoignable après une intervention.
   */
  private async traceBinding(
    request: AdminRequest,
    nodeId: string,
    target: NodeBindingInput,
    outcome: RebindOutcome,
  ): Promise<void> {
    if (outcome.status === "unchanged") return;

    const trace = {
      serverId: null,
      actorId: request.user.id,
      actorType: "user" as const,
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { nodeId, ...target, changed: outcome.changed, failure: outcome.failure },
    };

    if (outcome.status === "applied") {
      await this.activityLog.record({ ...trace, event: "node.binding_changed" });
    } else if (outcome.status === "restart_required") {
      await this.activityLog.record({ ...trace, event: "node.binding_pending_restart" });
    } else {
      await this.activityLog.record({ ...trace, event: "node.binding_refused" });
      // Le fichier rendu porte le jeton du node en clair : sa sortie se
      // consigne comme celle de la route de configuration.
      if (outcome.file) {
        await this.activityLog.record({
          ...trace,
          event: "node.configuration_read",
          properties: { nodeId },
        });
      }
    }
  }

  /** Le stock de ports, avec le serveur qui occupe chacun. */
  @Get(":nodeId/allocations")
  async allocations(@Param("nodeId") nodeId: string) {
    return { data: await this.infrastructure.allocationsOf(nodeId) };
  }

  /**
   * Retire des ports du stock. Tout ou rien : un port occupé par un serveur
   * fait tout refuser, et le refus nomme les ports et les serveurs.
   *
   * `POST …/remove` plutôt que `DELETE` avec un corps : certains relais
   * suppriment le corps d'un `DELETE`, et la liste d'identifiants ne tient pas
   * dans une URL quand on retire une plage entière.
   */
  @Post(":nodeId/allocations/remove")
  @UseGuards(AdminWriteGuard)
  async removeAllocations(
    @Req() request: AdminRequest,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    const { ids } = parseBody(AllocationRemovalInput, body);
    const outcome = await this.infrastructure.removeAllocations(nodeId, ids);

    await this.activityLog.record({
      event: "node.allocations_removed",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { nodeId, removed: outcome.removed },
    });

    return { data: outcome };
  }
}
