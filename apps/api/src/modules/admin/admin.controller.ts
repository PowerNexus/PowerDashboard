import { Readable } from "node:stream";
import { AuditExportQuery, AuditFilters, ServerLimitsPatch } from "@gamedashboard/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ActivityService } from "../activity/activity.service";
import { IMPERSONATION_TTL_MS, impersonationReturnCookie } from "../auth/impersonation";
import type { AuthenticatedRequest } from "../auth/session.guard";
import { authCookieOptions, SessionGuard, sessionCookie } from "../auth/session.guard";
import { SessionRepository } from "../auth/session.repository";
import { ServerResizeService } from "../client/server-resize.service";
import { MailerService } from "../mail/mailer.service";
import { BrandingService } from "../reseller/branding.service";
import { ResellerQuotaService } from "../reseller/reseller-quota.service";
import { ResellerShareService } from "../reseller/reseller-share.service";
import { RetentionService } from "../scheduler/retention.service";
import { WingsUnavailableError } from "../wings/wings-client.service";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";
import { AdminActionsService } from "./admin-actions.service";
import { AdminServerService } from "./admin-server.service";
import { AdminWriteGuard } from "./admin-write.guard";
import { AnnouncementsService } from "./announcements.service";
import { DatabaseHostsService } from "./database-hosts.service";
import { EggEditorService } from "./egg-editor.service";
import { EggImportService } from "./egg-import.service";
import { InfrastructureService } from "./infrastructure.service";
import { MountsService } from "./mounts.service";
import { NodeConfigurationService } from "./node-configuration.service";
import { LOAD_WINDOWS, NodeLoadService } from "./node-load.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { ServerTransferService } from "./server-transfer.service";
import { StaffTwoFactorGuard } from "./staff-2fa.guard";

/** `AuthenticatedRequest` ne porte ni l'adresse ni les en-têtes : Fastify les pose à part. */
type AdminRequest = AuthenticatedRequest & {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * Ce dont la prise en main a besoin de la réponse.
 *
 * Décrit ici plutôt qu'importé de Fastify : le contrôleur ne connaît de la
 * réponse que ce qu'il en emploie, et une signature complète le lierait au
 * serveur HTTP sous-jacent.
 */
interface ImpersonationReply {
  setCookie(name: string, value: string, options: Record<string, unknown>): ImpersonationReply;
  send(body: unknown): void;
}

/** Ce dont un téléchargement a besoin de la réponse, pour la même raison. */
interface DownloadReply {
  header(name: string, value: string): DownloadReply;
  send(body: unknown): void;
}

/**
 * Les filtres du journal, validés.
 *
 * Partagé par la liste et l'export : un seul schéma, donc une seule lecture
 * de `?query=&event=&actorId=…`.
 */
function auditFiltersOf(query: Record<string, unknown>): AuditFilters {
  const parsed = AuditFilters.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message ?? "Filtres invalides.");
  }
  return parsed.data;
}
/**
 * Identifiant d'egg contrôlé avant d'atteindre la base.
 *
 * Sans lui, `/admin/eggs/nimporte-quoi` arrivait jusqu'à PostgreSQL, qui
 * refusait la conversion en UUID : une erreur 500 pour une adresse mal tapée.
 * Un identifiant illisible désigne un egg qui n'existe pas, et se dit en 404.
 */
const EGG_ID = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException("Egg introuvable."),
});

/** Premier en-tête, quand Fastify en rend plusieurs. */
function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Espace d'administration, en lecture.
 *
 * Les deux gardes sont cumulés et dans cet ordre : la session d'abord, le rôle
 * ensuite. Inverser reviendrait à lire un rôle sur une requête non
 * authentifiée, donc sur un utilisateur qui n'existe pas encore.
 */
@Controller("api/v1/admin")
@UseGuards(SessionGuard, AdminGuard, StaffTwoFactorGuard)
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AdminServerService) private readonly adminServers: AdminServerService,
    @Inject(AdminActionsService) private readonly actions: AdminActionsService,
    @Inject(PlatformSettingsService) private readonly platform: PlatformSettingsService,
    @Inject(RetentionService) private readonly retentionService: RetentionService,
    @Inject(MailerService) private readonly mail: MailerService,
    @Inject(ServerTransferService) private readonly transfers: ServerTransferService,
    @Inject(DatabaseHostsService) private readonly databaseHosts_: DatabaseHostsService,
    @Inject(ActivityService) private readonly activityLog: ActivityService,
    @Inject(MountsService) private readonly mountsService: MountsService,
    @Inject(ResellerQuotaService) private readonly quotas: ResellerQuotaService,
    @Inject(EggImportService) private readonly eggImport: EggImportService,
    @Inject(EggEditorService) private readonly eggEditor: EggEditorService,
    @Inject(InfrastructureService) private readonly infrastructure: InfrastructureService,
    @Inject(ResellerShareService) private readonly shares: ResellerShareService,
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(NodeConfigurationService) private readonly nodeConfig: NodeConfigurationService,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(AnnouncementsService) private readonly announcementsService: AnnouncementsService,
    @Inject(NodeLoadService) private readonly nodeLoad_: NodeLoadService,
    // La troisième porte du redimensionnement, la même que la boutique et
    // l.espace revendeur empruntent.
    @Inject(ServerResizeService) private readonly resize: ServerResizeService,
  ) {}

  @Get("overview")
  async overview() {
    return { data: await this.admin.overview() };
  }

  @Get("nodes")
  async nodes() {
    return { data: await this.admin.nodes() };
  }

  @Get("servers")
  async servers() {
    return { data: await this.admin.servers() };
  }

  @Get("users")
  async users() {
    return { data: await this.admin.users() };
  }

  @Get("eggs")
  async eggs() {
    return { data: await this.admin.eggs() };
  }

  /* --- Entretien de la base ------------------------------------------------ */

  /**
   * Ce que la rétention a fait, et ce qu'elle garde.
   *
   * Route de pure lecture, et c'est justement ce qui manquait : le service
   * n'écrivait au journal que lorsqu'il effaçait quelque chose. Sur une
   * plateforme jeune, il ne disait donc jamais rien — indiscernable d'un
   * minuteur jamais armé, et on ne l'aurait appris qu'au disque plein.
   *
   * Réservée à l'administration : les fenêtres de conservation décrivent
   * combien de temps la plateforme garde les traces de ses clients.
   */
  @Get("maintenance/retention")
  retention() {
    return { data: this.retentionService.report() };
  }

  /* --- Réglages de la plateforme ------------------------------------------ */

  @Get("settings")
  async settings() {
    return { data: await this.platform.all() };
  }

  /**
   * Éprouve la configuration SMTP en s'envoyant un courrier.
   *
   * **Un envoi réel, et non une simple connexion.** Ouvrir la session et
   * s'authentifier écarte la plupart des fautes, mais pas celles qui comptent
   * ensuite : une adresse d'expédition que le serveur refuse, un relais
   * interdit pour ce domaine. Ces refus n'arrivent qu'au moment d'envoyer, et
   * ce sont eux qu'on découvre autrement le jour où un client ne peut plus
   * réinitialiser son mot de passe.
   *
   * Le destinataire est **l'administrateur qui demande**, jamais une adresse
   * reçue dans la requête : un panel qui envoie où on lui dit est un relais
   * ouvert, et le premier usage qu'on en ferait serait d'expédier depuis un
   * domaine de confiance.
   *
   * La cause de l'échec est rendue telle que le serveur l'a écrite. C'est la
   * seule chose exploitable ici — « échec de l'envoi » obligerait à ouvrir un
   * journal auquel l'exploitant n'a pas forcément accès.
   */
  @Post("settings/smtp/test")
  @UseGuards(AdminWriteGuard)
  async testSmtp(@Req() request: AdminRequest) {
    const destinataire = request.user.email;
    const { ok, error } = await this.mail.sendAndReport({
      to: destinataire,
      subject: "Essai d'envoi depuis GameDashboard",
      text: [
        "Ce message confirme que la configuration SMTP du panel fonctionne.",
        "",
        "Il a été demandé depuis l'écran des réglages. Si vous ne l'attendiez",
        "pas, quelqu'un d'autre a accès à votre espace d'administration.",
        "",
      ].join("\n"),
    });

    await this.activityLog.record({
      event: "admin.smtp_tested",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      userAgent: headerValue(request.headers?.["user-agent"]),
      // L'issue est consignée, pas le message : une erreur SMTP peut contenir
      // le nom d'hôte du fournisseur, qui n'a rien à faire dans un journal lu
      // par plusieurs personnes.
      properties: { ok },
    });

    return { data: { ok, error, sentTo: ok ? destinataire : null } };
  }

  /**
   * Enregistre des réglages.
   *
   * Un secret reçu vide est ignoré : le formulaire ne peut pas le pré-remplir,
   * puisqu'on ne le relit jamais. Sans cette règle, enregistrer la couleur
   * d'accent effacerait le mot de passe SMTP.
   */
  @Post("settings")
  @UseGuards(AdminWriteGuard)
  async saveSettings(@Body() body: unknown) {
    const values = (body as { values?: unknown })?.values;
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new BadRequestException("Réglages manquants.");
    }
    const result = await this.platform.save(values as Record<string, unknown>);
    // La marque de la plateforme sert de repli à tous les domaines : sans
    // cette purge, le nouveau logo n'apparaîtrait qu'une minute plus tard, et
    // l'on rechargerait la page en croyant l'enregistrement perdu.
    if (result.saved.some((key) => key.startsWith("brand."))) this.branding.forgetAll();
    return { data: result };
  }

  @Post("settings/flags/:key")
  @UseGuards(AdminWriteGuard)
  async setFlag(@Param("key") key: string, @Body() body: unknown) {
    const enabled = (body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== "boolean") throw new BadRequestException("État manquant.");
    await this.platform.setFlag(key, enabled);
    return { data: { key, enabled } };
  }

  /* --- Presets de sous-utilisateurs (§5.2) --------------------------------- */

  /**
   * Les presets proposés à l'invitation, et ceux du code.
   *
   * Lisible par le support : savoir ce que « Modérateur » coche aide à
   * répondre à un client qui demande pourquoi son invité ne peut pas
   * redémarrer. Les modifier reste l'affaire de l'administration.
   */
  @Get("subuser-presets")
  async subuserPresets() {
    return { data: await this.platform.rolePresets() };
  }

  /**
   * Redéfinit les presets. Les sous-utilisateurs existants n'en sont pas
   * touchés : leurs permissions ont été recopiées à l'invitation.
   */
  @Post("subuser-presets")
  @UseGuards(AdminWriteGuard)
  async saveSubuserPresets(@Req() request: AdminRequest, @Body() body: unknown) {
    const view = await this.platform.saveRolePresets((body as { presets?: unknown })?.presets);
    await this.activityLog.record({
      event: "admin.subuser_presets_saved",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      userAgent: headerValue(request.headers?.["user-agent"]),
      properties: { presets: view.presets },
    });
    return { data: view };
  }

  @Post("subuser-presets/reset")
  @UseGuards(AdminWriteGuard)
  async resetSubuserPresets(@Req() request: AdminRequest) {
    const view = await this.platform.resetRolePresets();
    await this.activityLog.record({
      event: "admin.subuser_presets_reset",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      userAgent: headerValue(request.headers?.["user-agent"]),
    });
    return { data: view };
  }

  /* --- Annonces ------------------------------------------------------------ */

  @Get("announcements")
  async announcements() {
    return { data: await this.announcementsService.list() };
  }

  @Post("announcements")
  @UseGuards(AdminWriteGuard)
  async saveAnnouncement(@Body() body: unknown) {
    return { data: await this.announcementsService.save(this.announcementInput(body)) };
  }

  @Delete("announcements/:announcementId")
  @UseGuards(AdminWriteGuard)
  async deleteAnnouncement(@Param("announcementId") announcementId: string) {
    await this.announcementsService.remove(announcementId);
    return { data: { deleted: announcementId } };
  }

  /**
   * Lit une annonce depuis le corps de la requête.
   *
   * Les dates sont laissées telles quelles : le service tranche sur la fenêtre,
   * et un contrôle ici en ferait un second endroit à corriger le jour où la
   * règle change.
   */
  private announcementInput(body: unknown) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const text = (key: string): string | undefined =>
      typeof payload[key] === "string" ? (payload[key] as string) : undefined;

    return {
      id: text("id"),
      title: text("title"),
      bodyMd: text("bodyMd"),
      level: text("level") as "info" | "warning" | "critical" | undefined,
      startsAt: text("startsAt"),
      endsAt: text("endsAt") ?? null,
      audience: Array.isArray(payload.audience)
        ? payload.audience.filter((role): role is string => typeof role === "string")
        : [],
    };
  }

  /* --- Domaines des revendeurs ------------------------------------------- */

  /**
   * Domaines propres déclarés, vérifiés ou non.
   *
   * L'administration a besoin de cette liste pour une raison concrète : le
   * panel reconnaît ces domaines, mais ne délivre pas leur certificat TLS. Sans
   * cet écran, personne ne saurait quels noms doivent en recevoir un, et les
   * clients du revendeur tomberaient sur un avertissement de sécurité.
   */
  @Get("reseller-domains")
  async resellerDomains() {
    return { data: await this.branding.declaredDomains() };
  }

  /* --- Montages ------------------------------------------------------------ */

  @Get("mounts")
  async mounts() {
    return { data: await this.mountsService.list() };
  }

  @Post("mounts")
  @UseGuards(AdminWriteGuard)
  async createMount(@Body() body: unknown) {
    return { data: await this.mountsService.create(this.mountInput(body)) };
  }

  @Post("mounts/:mountId")
  @UseGuards(AdminWriteGuard)
  async updateMount(@Param("mountId") mountId: string, @Body() body: unknown) {
    return { data: await this.mountsService.update(mountId, this.mountInput(body)) };
  }

  @Delete("mounts/:mountId")
  @UseGuards(AdminWriteGuard)
  async deleteMount(@Param("mountId") mountId: string) {
    await this.mountsService.remove(mountId);
    return { data: { deleted: mountId } };
  }

  /** Montages d'un serveur, et ceux qu'on pourrait encore lui attacher. */
  @Get("servers/:serverId/mounts")
  async serverMounts(@Param("serverId") serverId: string) {
    return { data: await this.mountsService.forServer(serverId) };
  }

  @Post("servers/:serverId/mounts/:mountId")
  @UseGuards(AdminWriteGuard)
  async attachMount(@Param("serverId") serverId: string, @Param("mountId") mountId: string) {
    await this.mountsService.attach(serverId, mountId);
    return { data: { attached: mountId } };
  }

  @Delete("servers/:serverId/mounts/:mountId")
  @UseGuards(AdminWriteGuard)
  async detachMount(@Param("serverId") serverId: string, @Param("mountId") mountId: string) {
    await this.mountsService.detach(serverId, mountId);
    return { data: { detached: mountId } };
  }

  /**
   * Lit un montage depuis le corps de la requête.
   *
   * `readOnly` vaut **vrai** par défaut, et l'écriture doit être demandée
   * explicitement : un montage en écriture donne au serveur de jeu le droit de
   * modifier ce que ses voisins lisent, et ce n'est pas un défaut qu'on hérite
   * d'un champ oublié.
   */
  private mountInput(body: unknown) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const text = (key: string): string =>
      typeof payload[key] === "string" ? (payload[key] as string) : "";

    return {
      name: text("name"),
      source: text("source"),
      target: text("target"),
      readOnly: payload.readOnly !== false,
      userMountable: payload.userMountable === true,
    };
  }

  /* --- Journal d'audit ----------------------------------------------------- */

  /**
   * Le journal de toute la plateforme.
   *
   * Lecture seule, et il n'existera jamais de route pour y écrire à la main ou
   * en effacer une ligne : un journal qu'on peut retoucher ne prouve rien.
   *
   * Ouvert au support autant qu'à l'administration — c'est `AdminGuard` qui en
   * décide — parce que répondre à « qui a supprimé ce serveur » est précisément
   * le travail du support.
   */
  @Get("activity")
  async activity(@Query() query: Record<string, unknown>) {
    const result = await this.activityLog.forPlatform({
      ...auditFiltersOf(query),
      page: Number(query.page) || 1,
    });

    return { data: result.items, meta: { page: result.page, hasMore: result.hasMore } };
  }

  /**
   * Exporte le journal, en CSV ou en JSON par lignes (PLAN §5.4).
   *
   * **Mêmes filtres que la liste**, lus par le même schéma et traduits en SQL
   * par la même fonction : le fichier contient ce que l'écran montrait, sans
   * la limite de la page.
   *
   * **Administrateurs seulement**, alors que la lecture est ouverte au
   * support. Consulter une ligne pour répondre à un client est son travail ;
   * emporter le journal entier — adresses IP, noms, activité de chaque compte
   * — hors du panel est un autre geste, qui se décide plus haut.
   *
   * La réponse part **en flux** : le journal est lu par blocs et chaque bloc
   * est écrit dès qu'il est prêt. Un journal de plusieurs millions de lignes
   * ne passe jamais entier par la mémoire de l'API.
   */
  @Get("activity/export")
  @UseGuards(AdminWriteGuard)
  async exportActivity(
    @Req() request: AdminRequest,
    @Query() query: Record<string, unknown>,
    @Res() reply: DownloadReply,
  ): Promise<void> {
    const parsed = AuditExportQuery.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Filtres invalides.");
    }
    const { format, ...filters } = parsed.data;

    const file = await this.activityLog.exportPlatform({
      filters,
      format,
      actor: {
        id: request.user.id,
        label: request.user.email,
        ip: request.ip ?? null,
        userAgent: headerValue(request.headers?.["user-agent"]),
      },
    });

    reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      // Un export dit l'état du journal à un instant : aucun intermédiaire
      // n'a à le resservir, encore moins à quelqu'un d'autre.
      .header("cache-control", "no-store")
      .send(Readable.from(file.chunks));
  }

  /* --- Hôtes de bases de données ------------------------------------------ */

  @Get("database-hosts")
  async databaseHosts() {
    return { data: await this.databaseHosts_.list() };
  }

  /**
   * Éprouve des identifiants sans rien enregistrer.
   *
   * Le mot de passe arrive en clair et n'est écrit nulle part : c'est un essai,
   * pas une déclaration. Le proposer séparément évite d'avoir à enregistrer un
   * hôte pour savoir s'il répond.
   */
  @Post("database-hosts/test")
  @UseGuards(AdminWriteGuard)
  async testDatabaseHost(@Body() body: unknown) {
    const input = this.hostInput(body);
    if (input.password === "") throw new BadRequestException("Mot de passe manquant.");
    return { data: await this.databaseHosts_.probe(input) };
  }

  @Post("database-hosts")
  @UseGuards(AdminWriteGuard)
  async createDatabaseHost(@Body() body: unknown) {
    return { data: await this.databaseHosts_.create(this.hostInput(body)) };
  }

  @Post("database-hosts/:hostId")
  @UseGuards(AdminWriteGuard)
  async updateDatabaseHost(@Param("hostId") hostId: string, @Body() body: unknown) {
    return { data: await this.databaseHosts_.update(hostId, this.hostInput(body)) };
  }

  @Delete("database-hosts/:hostId")
  @UseGuards(AdminWriteGuard)
  async deleteDatabaseHost(@Param("hostId") hostId: string) {
    await this.databaseHosts_.remove(hostId);
    return { data: { deleted: hostId } };
  }

  /**
   * Lit un hôte depuis le corps de la requête.
   *
   * Les champs sont énumérés un par un plutôt que transtypés en bloc : le corps
   * vient du réseau, et un `as DatabaseHostInput` ferait entrer n'importe quelle
   * valeur dans une requête SQL de création d'utilisateur.
   */
  private hostInput(body: unknown) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const text = (key: string): string =>
      typeof payload[key] === "string" ? (payload[key] as string) : "";

    return {
      name: text("name"),
      host: text("host"),
      port: typeof payload.port === "number" ? payload.port : 3306,
      username: text("username"),
      // Absent vaut « ne change rien » à la mise à jour, et est refusé à la
      // création : les deux cas sont tranchés par le service.
      password: text("password"),
      nodeId: typeof payload.nodeId === "string" && payload.nodeId !== "" ? payload.nodeId : null,
      maxDatabases:
        typeof payload.maxDatabases === "number" && Number.isFinite(payload.maxDatabases)
          ? payload.maxDatabases
          : null,
    };
  }

  /* --- Comptes ------------------------------------------------------------- */

  /**
   * Crée un compte.
   *
   * Le mot de passe provisoire n'est rendu **qu'ici**, dans la réponse à
   * l'appel qui vient de le tirer. Aucune lecture ultérieure ne le redonne : ce
   * qui est stocké est un condensat, et l'administrateur qui ferme la fenêtre
   * sans le noter devra en créer un autre.
   */
  @Post("users")
  @UseGuards(AdminWriteGuard)
  async createUser(@Body() body: unknown) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const text = (key: string): string =>
      typeof payload[key] === "string" ? (payload[key] as string) : "";

    return {
      data: await this.actions.createUser({
        email: text("email"),
        nameFirst: text("nameFirst"),
        nameLast: text("nameLast"),
        role: text("role") || "user",
        // Absent vaut **avec** mot de passe : c'est le cas courant, et un compte
        // créé sans accès par inadvertance ne se remarque qu'au support.
        withPassword: payload.withPassword !== false,
      }),
    };
  }

  @Post("users/:userId/role")
  @UseGuards(AdminWriteGuard)
  async setUserRole(
    @Req() request: AdminRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const role = (body as { role?: unknown })?.role;
    if (typeof role !== "string") throw new BadRequestException("Rôle manquant.");
    await this.actions.setUserRole(request.user.id, userId, role);
    return { data: { userId, role } };
  }

  /**
   * Enveloppes de ressources, avec la consommation en regard.
   *
   * Servies ensemble : un plafond sans ce qu'il reste ne permet pas de décider
   * s'il faut le relever, et c'est précisément la question qu'on se pose en
   * ouvrant cet écran.
   */
  @Get("reseller-quotas")
  async resellerQuotas() {
    return { data: await this.quotas.all() };
  }

  @Get("reseller-quotas/:userId")
  async resellerQuota(@Param("userId") userId: string) {
    return { data: await this.quotas.report(userId) };
  }

  /**
   * Pose l'enveloppe d'un revendeur.
   *
   * Chaque dimension accepte un nombre ou `null`, et `null` veut dire **sans
   * limite** — c'est ainsi qu'on retire un plafond. Un champ absent est refusé
   * plutôt qu'interprété : « je n'ai rien dit » et « plus de limite » ne
   * doivent pas se confondre quand l'un des deux ouvre la vanne.
   */
  @Post("users/:userId/quota")
  @UseGuards(AdminWriteGuard)
  async setResellerQuota(@Param("userId") userId: string, @Body() body: unknown) {
    const quota = {
      memoryMb: this.quotaField(body, "memoryMb"),
      diskMb: this.quotaField(body, "diskMb"),
      serversMax: this.quotaField(body, "serversMax"),
    };

    await this.quotas.setQuota(userId, quota);
    return { data: { userId, quota } };
  }

  /** Un entier positif, ou `null` pour « sans limite ». Rien d'autre. */
  private quotaField(body: unknown, key: "memoryMb" | "diskMb" | "serversMax"): number | null {
    const value = (body as Record<string, unknown> | null)?.[key];
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`« ${key} » doit être un entier positif ou null.`);
    }
    return value;
  }

  @Post("users/:userId/revoke-sessions")
  @UseGuards(AdminWriteGuard)
  async revokeSessions(@Param("userId") userId: string) {
    return { data: await this.actions.revokeUserSessions(userId) };
  }

  @Delete("users/:userId")
  @UseGuards(AdminWriteGuard)
  async deleteUser(@Req() request: AdminRequest, @Param("userId") userId: string) {
    await this.actions.deleteUser(request.user.id, userId);
    return { data: { deleted: userId } };
  }

  /* --- Prise en main d'un compte ------------------------------------------- */

  /**
   * Ouvre une session **en lecture seule** sur le compte d'un client.
   *
   * Le besoin est concret et quotidien : « chez moi le bouton ne marche pas ».
   * Le décrire par téléphone prend un quart d'heure ; le voir prend dix
   * secondes. La seule alternative honnête — demander son mot de passe au
   * client — est exactement ce qu'un hébergeur ne doit jamais faire.
   *
   * Quatre bornes, et chacune répond à une objection précise :
   *
   * 1. **Lecture seule**, tenue par `ImpersonationReadOnlyGuard`. Une écriture
   *    serait consignée au nom du client, et rien ne dirait qu'un agent en est
   *    l'auteur.
   * 2. **Jamais sur un compte du personnel.** Devenir un autre administrateur
   *    contournerait toute séparation des rôles, y compris la sienne propre.
   * 3. **Trente minutes.** Une prise en main est un geste de diagnostic, pas un
   *    accès ; une session ordinaire de douze heures ouverte chez un client
   *    serait un accès.
   * 4. **Consignée au départ et au retour**, des deux côtés — chez l'agent et
   *    chez le client, qui doit pouvoir le lire dans son propre journal.
   *
   * La session de l'agent n'est **pas** fermée : son jeton est mis de côté dans
   * un second cookie, pour qu'il revienne chez lui d'un clic. Sans cela, chaque
   * diagnostic coûterait une reconnexion complète, et l'on finirait par ne plus
   * s'en servir.
   */
  @Post("users/:userId/impersonate")
  // Entrer dans le compte d'un client est un geste d'administrateur, pas de
  // lecture : le rôle d'assistance regarde le parc, il n'y entre pas.
  @UseGuards(AdminWriteGuard)
  async impersonate(
    @Req() request: AdminRequest,
    @Param("userId") userId: string,
    @Res() reply: ImpersonationReply,
  ): Promise<void> {
    const target = await this.actions.impersonationTarget(request.user.id, userId);

    const token = await this.sessions.create(target.id, {
      ip: request.ip ?? null,
      userAgent: headerValue(request.headers?.["user-agent"]),
      authMethod: "impersonation",
      impersonatorId: request.user.id,
      ttlMs: IMPERSONATION_TTL_MS,
    });

    for (const entry of [
      { actorId: request.user.id, label: request.user.email },
      // La même ligne chez le client : son journal doit dire qui est entré,
      // sans qu'il ait à demander.
      { actorId: target.id, label: target.email },
    ]) {
      await this.activityLog.record({
        event: "account.impersonation_started",
        serverId: null,
        actorId: entry.actorId,
        actorType: "user",
        actorLabel: entry.label,
        ip: request.ip ?? null,
        properties: { staff: request.user.email, account: target.email },
      });
    }

    reply
      // Le jeton de l'agent est mis de côté, pas jeté : c'est ce qui permet le
      // retour. Même protections que le cookie de session, et il meurt avec la
      // prise en main.
      .setCookie(impersonationReturnCookie(), request.sessionToken ?? "", {
        ...authCookieOptions(),
        maxAge: IMPERSONATION_TTL_MS / 1000,
      })
      .setCookie(sessionCookie(), token, {
        ...authCookieOptions(),
        maxAge: IMPERSONATION_TTL_MS / 1000,
      })
      .send({ data: { account: target.email } });
  }

  /* --- Serveurs ------------------------------------------------------------ */

  /**
   * Fiche complète d'un serveur, telle que seule l'administration la voit.
   *
   * Elle porte la **commande résolue** : l'invocation avec ses gabarits
   * remplacés, c'est-à-dire ce que le conteneur lancera réellement. C'est le
   * seul endroit où un environnement incomplet se remarque avant le démarrage.
   */
  @Get("servers/:serverId")
  async serverDetail(@Param("serverId") serverId: string) {
    return { data: await this.adminServers.detail(serverId) };
  }

  /**
   * Image de conteneur et commande de démarrage.
   *
   * Deux leviers que l'espace client n'offre pas : une commande libre permet
   * d'exécuter ce qu'on veut dans le conteneur, une image arbitraire de sortir
   * du catalogue éprouvé par l'egg. Un hébergeur en a besoin, un client non.
   */
  @Post("servers/:serverId/runtime")
  @UseGuards(AdminWriteGuard)
  async setServerRuntime(@Param("serverId") serverId: string, @Body() body: unknown) {
    const payload = (body ?? {}) as {
      dockerImage?: unknown;
      startup?: unknown;
      oomKiller?: unknown;
    };
    await this.adminServers.setRuntime(serverId, {
      dockerImage: typeof payload.dockerImage === "string" ? payload.dockerImage : undefined,
      startup: typeof payload.startup === "string" ? payload.startup : undefined,
      oomKiller: typeof payload.oomKiller === "boolean" ? payload.oomKiller : undefined,
    });
    return { data: { updated: serverId } };
  }

  /**
   * Change le jeu d'un serveur.
   *
   * Sans cette route, changer de jeu passait par une suppression et une
   * recréation : identifiant court perdu, sous-utilisateurs, planifications et
   * historique avec. Elle remplace l'egg, ses variables, la commande et
   * l'image — et, si on le demande, fait réexécuter le script d'installation
   * du nouveau jeu sur le volume existant.
   *
   * `reinstall` est explicite et n'a pas de valeur par défaut vraie : c'est
   * l'étape irréversible, celle qui écrit dans les fichiers du client. Un
   * hébergeur peut vouloir changer l'egg seul — pour réparer une fiche — et
   * laisser le client déclencher la réinstallation quand il est prêt.
   */
  @Post("servers/:serverId/egg")
  @UseGuards(AdminWriteGuard)
  async setServerEgg(@Param("serverId") serverId: string, @Body() body: unknown) {
    const payload = (body ?? {}) as { eggId?: unknown; reinstall?: unknown };
    if (typeof payload.eggId !== "string" || payload.eggId.trim() === "") {
      throw new BadRequestException("Jeu manquant.");
    }
    const reinstall = payload.reinstall === true;
    await this.adminServers.setEgg(serverId, payload.eggId, reinstall);
    return { data: { updated: serverId, reinstall } };
  }

  /**
   * Change les limites d'un serveur.
   *
   * La troisième porte du même service, après l'API applicative et l'espace
   * revendeur. L'administration en a besoin pour la même raison que les deux
   * autres — et pour une de plus : quand un revendeur ferme, c'est elle qui
   * reprend son parc.
   *
   * L'enveloppe du revendeur qui héberge s'applique **aussi** ici : un
   * agrandissement fait par la plateforme sur sa machine est compté dans sa
   * consommation, il doit donc l'être dans son refus.
   */
  @Post("servers/:serverId/limits")
  @UseGuards(AdminWriteGuard)
  async setServerLimits(
    @Req() request: AdminRequest,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
  ) {
    const parsed = ServerLimitsPatch.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Limites invalides.");
    }

    const limites = await this.resize.resize(
      { id: request.user.id, role: "admin" },
      serverId,
      parsed.data,
    );

    await this.activityLog.record({
      event: "admin.server_resized",
      serverId,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { ...parsed.data },
    });

    return { data: limites };
  }

  /**
   * Change le propriétaire d'un serveur.
   *
   * Le rattachement au revendeur ne suit **pas** : il dit qui héberge, pas qui
   * possède. Un serveur qui change de mains ne change pas de machine.
   */
  @Post("servers/:serverId/owner")
  @UseGuards(AdminWriteGuard)
  async setServerOwner(
    @Req() request: AdminRequest,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
  ) {
    const { ownerId } = (body ?? {}) as { ownerId?: unknown };
    if (typeof ownerId !== "string" || ownerId.trim() === "") {
      throw new BadRequestException("Compte destinataire manquant.");
    }

    await this.adminServers.setOwner(serverId, ownerId);

    await this.activityLog.record({
      event: "admin.server_owner_changed",
      serverId,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { ownerId },
    });

    return { data: { updated: serverId } };
  }

  /**
   * Déménage un serveur vers un autre node.
   *
   * Réservé à l'administration, et cela ne changera pas : le transfert décide
   * de la machine sur laquelle tourne le serveur d'un client, arrête celui-ci
   * le temps du voyage, et lui fait changer d'adresse. Aucune de ces trois
   * conséquences n'appartient au client.
   */
  @Post("servers/:serverId/transfer")
  @UseGuards(AdminWriteGuard)
  async transferServer(@Param("serverId") serverId: string, @Body() body: unknown) {
    const { nodeId } = (body ?? {}) as { nodeId?: unknown };
    if (typeof nodeId !== "string" || nodeId.trim() === "") {
      throw new BadRequestException("Node de destination manquant.");
    }

    return { data: await this.transfers.start(serverId, nodeId) };
  }

  /** Écrit une variable d'egg, y compris celles fermées au propriétaire. */
  @Post("servers/:serverId/variables")
  @UseGuards(AdminWriteGuard)
  async setServerVariable(@Param("serverId") serverId: string, @Body() body: unknown) {
    const payload = (body ?? {}) as { envVariable?: unknown; value?: unknown };
    if (typeof payload.envVariable !== "string" || payload.envVariable.trim() === "") {
      throw new BadRequestException("Variable manquante.");
    }
    await this.adminServers.setVariable(
      serverId,
      payload.envVariable.trim(),
      typeof payload.value === "string" ? payload.value : "",
    );
    return { data: { updated: payload.envVariable } };
  }

  @Post("servers/:serverId/suspend")
  @UseGuards(AdminWriteGuard)
  async suspendServer(@Param("serverId") serverId: string, @Body() body: unknown) {
    const { suspended, reason } = (body ?? {}) as { suspended?: unknown; reason?: unknown };
    if (typeof suspended !== "boolean") throw new BadRequestException("État manquant.");
    await this.actions.setServerSuspended(
      serverId,
      suspended,
      typeof reason === "string" ? reason : "",
    );
    return { data: { serverId, suspended } };
  }

  @Delete("servers/:serverId")
  @UseGuards(AdminWriteGuard)
  async deleteServer(@Param("serverId") serverId: string) {
    await this.relay(() => this.actions.deleteServer(serverId));
    return { data: { deleted: serverId } };
  }

  /* --- Classement et localisations ----------------------------------------- */

  @Get("node-taxonomy")
  async nodeTaxonomy() {
    return { data: await this.infrastructure.taxonomy() };
  }

  @Post("node-categories")
  @UseGuards(AdminWriteGuard)
  async createNodeCategory(@Body() body: unknown) {
    const payload = (body ?? {}) as { name?: unknown; description?: unknown };
    if (typeof payload.name !== "string") throw new BadRequestException("Nom attendu.");
    return {
      data: await this.infrastructure.createCategory({
        name: payload.name,
        description: typeof payload.description === "string" ? payload.description : undefined,
      }),
    };
  }

  @Delete("node-categories/:categoryId")
  @UseGuards(AdminWriteGuard)
  async removeNodeCategory(@Param("categoryId") categoryId: string) {
    return { data: await this.infrastructure.removeCategory(categoryId) };
  }

  @Post("node-subcategories")
  @UseGuards(AdminWriteGuard)
  async createNodeSubcategory(@Body() body: unknown) {
    const payload = (body ?? {}) as { categoryId?: unknown; name?: unknown };
    if (typeof payload.categoryId !== "string" || typeof payload.name !== "string") {
      throw new BadRequestException("Catégorie et nom attendus.");
    }
    return {
      data: await this.infrastructure.createSubcategory({
        categoryId: payload.categoryId,
        name: payload.name,
      }),
    };
  }

  @Delete("node-subcategories/:subcategoryId")
  @UseGuards(AdminWriteGuard)
  async removeNodeSubcategory(@Param("subcategoryId") subcategoryId: string) {
    return { data: await this.infrastructure.removeSubcategory(subcategoryId) };
  }

  @Get("locations")
  async locations() {
    return { data: await this.infrastructure.listLocations() };
  }

  @Post("locations")
  @UseGuards(AdminWriteGuard)
  async createLocation(@Body() body: unknown) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const text = (key: string): string =>
      typeof payload[key] === "string" ? (payload[key] as string) : "";
    return {
      data: await this.infrastructure.createLocation({
        short: text("short"),
        long: text("long"),
        countryCode: text("countryCode"),
      }),
    };
  }

  @Delete("locations/:locationId")
  @UseGuards(AdminWriteGuard)
  async removeLocation(@Param("locationId") locationId: string) {
    await this.infrastructure.removeLocation(locationId);
    return { data: { removed: true } };
  }

  /* --- Nodes --------------------------------------------------------------- */

  /**
   * Déclare une machine.
   *
   * Le jeton du daemon n'est rendu **qu'ici**. C'est lui qu'on recopie dans la
   * configuration de Wings ; aucune lecture ultérieure ne le redonne en clair.
   */
  @Post("nodes")
  @UseGuards(AdminWriteGuard)
  async createNode(@Body() body: unknown) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const text = (key: string): string =>
      typeof payload[key] === "string" ? (payload[key] as string) : "";
    const num = (key: string, fallback: number): number =>
      typeof payload[key] === "number" ? (payload[key] as number) : fallback;

    return {
      data: await this.infrastructure.createNode({
        name: text("name"),
        locationId: text("locationId"),
        // Chaîne vide vaut « non classé » : c'est un choix possible, pas un
        // champ oublié.
        category: text("category") || null,
        subcategory: text("subcategory") || null,
        fqdn: text("fqdn"),
        scheme: text("scheme") || "https",
        daemonPort: num("daemonPort", 8080),
        daemonSftpPort: num("daemonSftpPort", 2022),
        memoryMb: num("memoryMb", 0),
        diskMb: num("diskMb", 0),
        cpuCores: num("cpuCores", 0),
        isPublic: payload.isPublic !== false,
      }),
    };
  }

  @Delete("nodes/:nodeId")
  @UseGuards(AdminWriteGuard)
  async removeNode(@Param("nodeId") nodeId: string) {
    await this.infrastructure.removeNode(nodeId);
    return { data: { removed: true } };
  }

  /**
   * Charge d'un node dans le temps.
   *
   * Lecture seule et sans écriture nulle part : la série est **calculée** à
   * partir des relevés par serveur, jamais rangée à part.
   */
  @Get("nodes/:nodeId/load")
  async nodeLoad(@Param("nodeId") nodeId: string, @Query("window") window?: string) {
    return {
      data: await this.nodeLoad_.series(nodeId, window ?? "24h"),
      meta: { windows: LOAD_WINDOWS },
    };
  }

  /* --- Configuration du daemon --------------------------------------------- */

  /**
   * Le `config.yml` à déposer sur la machine.
   *
   * **Sous `AdminWriteGuard` bien qu'il s'agisse d'une lecture** : ce fichier
   * porte le jeton du node en clair, et ce jeton confère un pouvoir total sur
   * la machine. Le protéger comme une lecture ordinaire le mettrait à portée
   * d'un compte qui n'a le droit de rien modifier.
   */
  @Get("nodes/:nodeId/configuration")
  @UseGuards(AdminWriteGuard)
  async nodeConfiguration(@Param("nodeId") nodeId: string, @Req() request: AdminRequest) {
    const configuration = await this.nodeConfig.fileFor(nodeId);

    // Le jeton sort du panel : qui l'a demandé et quand doit rester écrit,
    // même si l'on ne peut pas savoir ce qu'il en fera ensuite.
    await this.activityLog.record({
      event: "node.configuration_read",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: { nodeId },
    });

    return { data: { yaml: configuration.yaml, tokenId: configuration.tokenId } };
  }

  /**
   * Remplace le jeton du daemon, en le lui remettant d'abord.
   *
   * Le panel n'enregistre que ce que le node a confirmé savoir : un échec
   * laisse l'ancien jeton en service des deux côtés, plutôt que de couper la
   * machine du panel sans moyen de la rattraper à distance.
   */
  @Post("nodes/:nodeId/token/rotate")
  @UseGuards(AdminWriteGuard)
  async rotateNodeToken(@Param("nodeId") nodeId: string, @Req() request: AdminRequest) {
    const outcome = await this.nodeConfig.rotateToken(nodeId);

    await this.activityLog.record({
      event: outcome.applied ? "node.token_rotated" : "node.token_rotation_failed",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      // L'identifiant du jeton, jamais le secret : un journal d'audit se lit
      // par des gens qui n'ont pas à pouvoir s'en servir.
      properties: { nodeId, tokenId: outcome.tokenId, failure: outcome.failure },
    });

    return { data: outcome };
  }

  /* --- Répartition d'une machine entre revendeurs --------------------------- */

  /**
   * Les parts posées sur une machine, avec ce que chacune consomme.
   *
   * La consommation accompagne la part parce que c'est la question qu'on se
   * pose en la modifiant : réduire une part à 16 Go alors que 24 sont déjà pris
   * est un geste dont il faut voir la conséquence avant de le faire.
   */
  @Get("nodes/:nodeId/shares")
  async nodeShares(@Param("nodeId") nodeId: string) {
    return { data: await this.shares.sharesOfNode(nodeId) };
  }

  @Post("nodes/:nodeId/shares")
  @UseGuards(AdminWriteGuard)
  async setNodeShare(@Param("nodeId") nodeId: string, @Body() body: unknown) {
    const payload = (body ?? {}) as Record<string, unknown>;
    if (typeof payload.resellerId !== "string") {
      throw new BadRequestException("Revendeur attendu.");
    }

    const int = (key: string): number =>
      typeof payload[key] === "number" ? (payload[key] as number) : Number.NaN;

    return {
      data: await this.shares.setShare({
        nodeId,
        resellerId: payload.resellerId,
        memoryMb: int("memoryMb"),
        diskMb: int("diskMb"),
        // `null` est une valeur attendue — « aucun plafond sur le nombre de
        // serveurs » — et non un champ oublié.
        serversMax: payload.serversMax === null ? null : int("serversMax"),
      }),
    };
  }

  @Delete("nodes/:nodeId/shares/:resellerId")
  @UseGuards(AdminWriteGuard)
  async removeNodeShare(@Param("nodeId") nodeId: string, @Param("resellerId") resellerId: string) {
    await this.shares.removeShare(nodeId, resellerId);
    return { data: { removed: true } };
  }

  @Post("nodes/:nodeId/maintenance")
  @UseGuards(AdminWriteGuard)
  async setMaintenance(@Param("nodeId") nodeId: string, @Body() body: unknown) {
    const enabled = (body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== "boolean") throw new BadRequestException("État manquant.");
    await this.actions.setNodeMaintenance(nodeId, enabled);
    return { data: { nodeId, enabled } };
  }

  /**
   * Attribue un node à un revendeur, ou le rend à la plateforme.
   *
   * `ownerId: null` est une valeur **attendue**, pas un champ manquant : c'est
   * ainsi qu'on reprend une machine. Le distinguer d'un corps mal formé évite
   * qu'un « rendre à la plateforme » passe pour une erreur de saisie.
   */
  @Post("nodes/:nodeId/owner")
  @UseGuards(AdminWriteGuard)
  async setNodeOwner(@Param("nodeId") nodeId: string, @Body() body: unknown) {
    const ownerId = (body as { ownerId?: unknown })?.ownerId;
    if (ownerId !== null && typeof ownerId !== "string") {
      throw new BadRequestException("Identifiant de revendeur ou `null` attendu.");
    }

    await this.actions.setNodeOwner(nodeId, ownerId);
    return { data: { nodeId, ownerId } };
  }

  /**
   * Ajoute des ports au stock d'un node.
   *
   * Le corps accepte une plage (`from`/`to`) plutôt qu'une liste : déclarer
   * deux cents ports un par un depuis un formulaire n'est pas réaliste.
   */
  @Post("nodes/:nodeId/allocations")
  @UseGuards(AdminWriteGuard)
  async addAllocations(@Param("nodeId") nodeId: string, @Body() body: unknown) {
    const { ip, from, to } = (body ?? {}) as { ip?: unknown; from?: unknown; to?: unknown };
    if (typeof ip !== "string") throw new BadRequestException("Adresse IP manquante.");

    const start = Number(from);
    const end = Number(to ?? from);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      throw new BadRequestException("Plage de ports invalide.");
    }
    // Une plage ouverte épuiserait la mémoire avant d'atteindre la base.
    if (end - start > 5000) throw new BadRequestException("Plage trop large (5000 ports maximum).");

    const ports = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    return { data: await this.actions.addAllocations(nodeId, ip, ports) };
  }

  /* --- Catalogue ----------------------------------------------------------- */

  @Post("eggs/:eggId/enabled")
  @UseGuards(AdminWriteGuard)
  async setEggEnabled(@Param("eggId") eggId: string, @Body() body: unknown) {
    const enabled = (body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== "boolean") throw new BadRequestException("État manquant.");
    return { data: { eggId, enabled, ...(await this.actions.setEggEnabled(eggId, enabled)) } };
  }

  /**
   * Importe un export d'egg Pterodactyl.
   *
   * Le corps porte le fichier tel quel, sans enveloppe : c'est ce qu'on obtient
   * en collant un export, et exiger de le réemballer inviterait à l'éditer.
   */
  @Post("eggs/import")
  @UseGuards(AdminWriteGuard)
  async importEgg(@Body() body: unknown) {
    const payload = body as { egg?: unknown; nest?: unknown };
    const egg = payload?.egg;
    if (egg === undefined || egg === null) {
      throw new BadRequestException("Aucun egg : collez le contenu d'un export Pterodactyl.");
    }
    const nest = typeof payload.nest === "string" ? payload.nest : undefined;
    return { data: await this.eggImport.importOne({ json: egg, nestName: nest }) };
  }

  /** L'egg complet, variables et emploi par les serveurs compris, pour l'éditeur. */
  @Get("eggs/:eggId")
  async eggDetail(@Param("eggId", EGG_ID) eggId: string) {
    return { data: await this.eggEditor.detail(eggId) };
  }

  /**
   * L'egg au format d'import Pterodactyl (PTDL_v2).
   *
   * Rendu dans l'enveloppe habituelle plutôt qu'en pièce jointe : c'est
   * l'écran qui fabrique le fichier à télécharger, et le nom proposé voyage
   * avec le contenu. Réimporté tel quel — ici ou dans un Pterodactyl —, il
   * redonne le même egg.
   */
  @Get("eggs/:eggId/export")
  async exportEgg(@Param("eggId", EGG_ID) eggId: string) {
    return { data: await this.eggEditor.export(eggId) };
  }

  /**
   * Enregistre un egg modifié dans l'éditeur.
   *
   * Le corps est validé par `EggDraft` (contracts), le même schéma que l'écran
   * applique champ par champ. Les changements qui casseraient des serveurs en
   * service — retirer une variable employée, la rendre obligatoire sans
   * valeur par défaut — sont refusés en 409, avec la raison et le nombre de
   * serveurs concernés.
   */
  @Post("eggs/:eggId")
  @UseGuards(AdminWriteGuard)
  async updateEgg(
    @Req() request: AdminRequest,
    @Param("eggId", EGG_ID) eggId: string,
    @Body() body: unknown,
  ) {
    const report = await this.eggEditor.update(eggId, body);

    await this.activityLog.record({
      event: "admin.egg_updated",
      serverId: null,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      properties: {
        eggId,
        name: report.detail.name,
        variablesAdded: report.variablesAdded,
        variablesRemoved: report.variablesRemoved,
        servers: report.detail.servers,
      },
    });

    return { data: report };
  }

  /**
   * Le dépôt suivi et son contenu, pour l'écran de recherche.
   *
   * Servis ensemble : la liste n'a pas de sens sans savoir d'où elle vient, et
   * deux appels feraient deux allers-retours pour ouvrir une fenêtre.
   */
  @Get("egg-catalogue")
  async eggCatalogue() {
    const source = await this.eggImport.defaultSource();
    return { data: { source, entries: await this.eggImport.catalogue(source.id) } };
  }

  @Post("egg-catalogue/import")
  @UseGuards(AdminWriteGuard)
  async importFromCatalogue(@Body() body: unknown) {
    const payload = (body ?? {}) as { sourceId?: unknown; path?: unknown };
    if (typeof payload.sourceId !== "string" || typeof payload.path !== "string") {
      throw new BadRequestException("Source et chemin attendus.");
    }
    return { data: await this.eggImport.importFromSource(payload.sourceId, payload.path) };
  }

  @Get("egg-sources")
  async eggSources() {
    return { data: await this.eggImport.listSources() };
  }

  @Post("egg-sources")
  @UseGuards(AdminWriteGuard)
  async addEggSource(@Body() body: unknown) {
    const payload = body as { name?: unknown; url?: unknown; branch?: unknown };
    if (typeof payload?.name !== "string" || typeof payload?.url !== "string") {
      throw new BadRequestException("Nom et adresse du dépôt attendus.");
    }
    return {
      data: await this.eggImport.addSource({
        name: payload.name,
        url: payload.url,
        branch: typeof payload.branch === "string" ? payload.branch : undefined,
      }),
    };
  }

  @Delete("egg-sources/:sourceId")
  @UseGuards(AdminWriteGuard)
  async removeEggSource(@Param("sourceId") sourceId: string) {
    await this.eggImport.removeSource(sourceId);
    return { data: { removed: true } };
  }

  /**
   * Relit le dépôt et met le catalogue à jour.
   *
   * La réponse dit ce qui a été fait, y compris ce qui a échoué : une
   * synchronisation qui rend « terminé » sans chiffres laisse croire que tout
   * est passé, alors que le dépôt officiel contient des fichiers qui n'en sont
   * pas.
   */
  @Post("egg-sources/:sourceId/sync")
  @UseGuards(AdminWriteGuard)
  async syncEggSource(@Param("sourceId") sourceId: string) {
    return { data: await this.eggImport.syncSource(sourceId) };
  }

  /** Voir `ServerRuntimeController.relay` : un node muet n'est pas un bogue du panel. */
  private async relay<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof WingsUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}
