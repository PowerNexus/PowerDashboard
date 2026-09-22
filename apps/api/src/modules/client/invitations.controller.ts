import { checkPassword, hashPassword, identityFragments } from "@gamedashboard/auth";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ActivityService } from "../activity/activity.service";
import { ImpersonationReadOnlyGuard } from "../auth/impersonation.guard";
import type { AuthenticatedRequest } from "../auth/session.guard";
import { SessionGuard } from "../auth/session.guard";
import { type CookieSink, SessionIssuerService } from "../auth/session-issuer.service";
import { UserRepository } from "../auth/user.repository";
import { ServerInvitesService } from "./server-invites.service";

/** L'adresse d'appel, que Fastify pose sur la requête sans que le type le dise. */
type InviteRequest = AuthenticatedRequest & { ip?: string };

/**
 * Le bout du lien reçu par courriel.
 *
 * Contrôleur à part, et non une route de plus sous `client/servers/:id` : à cet
 * instant, celui qui ouvre le lien **n'a aucun accès au serveur**, et souvent
 * pas encore de compte. Le poser sous un préfixe gardé par les permissions du
 * serveur aurait exigé d'y percer un trou — exactement le genre d'exception qui
 * finit par servir à autre chose.
 *
 * L'aperçu est public parce qu'il doit l'être : on ne demande pas à quelqu'un
 * de créer un compte pour découvrir ensuite à quoi il s'engageait. Ce qu'il
 * révèle est borné — un nom de serveur, l'adresse invitée, les droits proposés
 * — et n'est atteignable qu'avec un secret de trente-deux octets envoyé à une
 * seule boîte.
 *
 * L'acceptation, elle, exige une session **portant l'adresse invitée** : sans
 * ce contrôle, un lien transféré donnerait l'accès à n'importe quel compte.
 */
@Controller("api/v1/invitations")
export class InvitationsController {
  constructor(
    @Inject(ServerInvitesService) private readonly invites: ServerInvitesService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SessionIssuerService) private readonly issuer: SessionIssuerService,
  ) {}

  @Get(":token")
  async preview(@Param("token") token: string) {
    return { data: await this.invites.preview(token) };
  }

  /**
   * Crée le compte de l'invité, puis accepte dans la foulée.
   *
   * **Fonctionne inscriptions fermées**, et c'est tout l'objet de cette route.
   * Fermer les inscriptions est le réglage naturel dès qu'un système de
   * facturation tient les comptes clients — mais un sous-utilisateur n'est pas
   * un client : personne ne lui vendra de serveur, il vient aider sur celui
   * d'un autre. Sans ce chemin, l'invitation par courriel devenait une
   * promesse morte : le lien arrivait, la personne cliquait, et la création de
   * compte lui était refusée.
   *
   * Ce n'est pas une porte dérobée dans le réglage : **l'adresse vient de
   * l'invitation**, jamais du corps de la requête. On ne peut donc créer qu'un
   * compte nominatif, à une adresse choisie par le propriétaire du serveur, et
   * seulement en détenant un secret de trente-deux octets envoyé à cette
   * boîte-là. Le réglage borne l'inscription **libre** ; celle-ci ne l'est pas.
   *
   * L'adresse naît **vérifiée** : le lien a prouvé la possession de la boîte,
   * ce qu'un courriel de confirmation ne ferait que redemander.
   */
  @Post(":token/register")
  async registerAndAccept(
    @Req() request: InviteRequest,
    @Res({ passthrough: true }) reply: CookieSink,
    @Param("token") token: string,
    @Body() body: unknown,
  ) {
    const { password, nameFirst, nameLast } = (body ?? {}) as Record<string, unknown>;
    if (typeof password !== "string" || password === "") {
      throw new BadRequestException("Mot de passe manquant.");
    }
    const prenom = typeof nameFirst === "string" ? nameFirst.trim() : "";
    const nom = typeof nameLast === "string" ? nameLast.trim() : "";
    if (prenom === "" || nom === "") throw new BadRequestException("Nom et prénom attendus.");

    const { email } = await this.invites.pending(token);

    if (await this.users.findByEmail(email)) {
      // L'invitation vise une adresse qui a acquis un compte entre-temps.
      // Connectez-vous : le lien reste bon, c'est l'acceptation qui prendra.
      throw new ConflictException(
        "Un compte existe déjà avec cette adresse. Connectez-vous, puis rouvrez ce lien.",
      );
    }

    /*
     * La même politique de mot de passe que l'inscription publique.
     *
     * Elle est appliquée ici plutôt que déléguée : la fonction est pure et
     * partagée, il n'y a rien à dupliquer. Un sous-utilisateur peut arrêter un
     * serveur et lire des fichiers de configuration — il n'y a aucune raison
     * de lui demander moins qu'à un client.
     */
    const { problems } = await checkPassword(password, {
      identity: identityFragments(email, prenom, nom),
      fetchImpl: globalThis.fetch as never,
    });
    if (problems.length > 0) {
      // Le détail part avec, comme sur l'inscription publique : l'écran doit
      // pouvoir dire ce qui manque, pas seulement que ça ne va pas.
      throw new BadRequestException({
        message: "Ce mot de passe ne convient pas.",
        problems,
      });
    }

    const created = await this.users.registerVerified({
      email,
      nameFirst: prenom,
      nameLast: nom,
      passwordHash: await hashPassword(password),
    });
    const userId = created.id;

    const { serverId } = await this.invites.accept(token, userId, email);

    await this.activity.record({
      event: "subuser.invite_accepted",
      serverId,
      actorId: userId,
      actorType: "user",
      actorLabel: email,
      ip: request.ip ?? null,
      userAgent: null,
      properties: { accountCreated: true },
    });

    // La session est ouverte par le fabricant commun : la personne vient de
    // créer son compte et d'accepter, la faire ensuite passer par l'écran de
    // connexion serait lui redemander ce qu'elle vient de fournir.
    const payload = await this.issuer.issue(
      userId,
      { ip: request.ip ?? null, userAgent: null },
      reply,
      "invitation",
    );

    return { data: { serverId }, ...payload };
  }

  /**
   * Accepte.
   *
   * `ImpersonationReadOnlyGuard` s'applique : un administrateur qui « regarde
   * en tant que » quelqu'un ne doit pas pouvoir accepter en son nom un accès
   * qui l'engage.
   */
  @Post(":token/accept")
  @UseGuards(SessionGuard, ImpersonationReadOnlyGuard)
  async accept(@Req() request: InviteRequest, @Param("token") token: string) {
    const { serverId } = await this.invites.accept(token, request.user.id, request.user.email);

    // Consigné sur le serveur, où le propriétaire le lira : c'est lui qui a
    // invité, et le journal du serveur est le seul endroit où il puisse
    // constater que l'accès a bien été pris.
    await this.activity.record({
      event: "subuser.invite_accepted",
      serverId,
      actorId: request.user.id,
      actorType: "user",
      actorLabel: request.user.email,
      ip: request.ip ?? null,
      userAgent: null,
      properties: {},
    });

    return { data: { serverId } };
  }
}
