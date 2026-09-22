import { decryptSecret } from "@gamedashboard/auth";
import {
  buildWingsNodeConfiguration,
  WINGS_CONFIGURE_PREFIX,
  type WingsNodeConfiguration,
} from "@gamedashboard/contracts";
import { type Database, nodes } from "@gamedashboard/db";
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import {
  ApplicationGuard,
  type ApplicationRequest,
  PlatformOnly,
  RequireScopes,
} from "./application.guard";
import { ApplicationKeyRepository } from "./application-key.repository";

/**
 * Mise en service d'un daemon : `wings configure`.
 *
 * Wings est gardé **non modifié**. C'est donc lui qui fixe l'adresse, et le
 * panel qui s'y plie :
 *
 *     wings configure --panel-url https://panel --token <clé> --node <uuid>
 *
 * Trois particularités, qui expliquent pourquoi ce contrôleur est à part
 * plutôt qu'une route de plus dans `ApplicationController` :
 *
 * 1. **Le préfixe n'est pas le nôtre.** `/api/application`, sans `v1`, est
 *    codé en dur dans le daemon. Le mettre ailleurs rendrait `wings configure`
 *    muet, et aucun test de notre API ne s'en apercevrait.
 * 2. **La réponse n'a pas d'enveloppe.** Wings désérialise le corps
 *    directement dans sa structure de configuration ; un `{ data: … }` lui
 *    donnerait une configuration vide sans la moindre erreur.
 * 3. **La réponse contient un secret.** Le jeton du daemon en sort en clair —
 *    c'est tout l'intérêt de la commande, qui évite de le recopier à la main —
 *    d'où une portée dédiée, `nodes.configure`, que l'on accorde en sachant
 *    qu'elle vaut le contrôle de la machine.
 */
@Controller(WINGS_CONFIGURE_PREFIX.replace(/^\//, ""))
@UseGuards(ApplicationGuard)
export class NodeConfigurationController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ApplicationKeyRepository) private readonly keys: ApplicationKeyRepository,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  @Get("nodes/:nodeId/configuration")
  @RequireScopes("nodes.configure")
  /*
   * Jamais pour une clé de revendeur, et le refus est ici plutôt qu'à la seule
   * émission.
   *
   * `nodes.configure` fait déjà partie des portées qu'un revendeur ne peut pas
   * s'accorder : ce contrôle-là serait donc théoriquement inutile. Il ne l'est
   * pas — la réponse contient le jeton du daemon, c'est-à-dire la machine
   * entière, et une règle qui ne vit qu'au moment de l'émission tombe le jour
   * où une clé est fabriquée autrement : un import, une reprise de base, une
   * route écrite plus tard. Le prix d'un oubli n'est pas symétrique.
   */
  @PlatformOnly("la configuration d'un node")
  async configuration(
    @Param("nodeId") nodeId: string,
    @Req() request: ApplicationRequest,
  ): Promise<WingsNodeConfiguration> {
    /*
     * Une clé bornée à un node ne configure que celui-là.
     *
     * Les clés d'amorçage transitent par un presse-papiers et un historique de
     * shell ; les borner change ce qu'une fuite coûte — une machine, et pas le
     * parc entier. Une clé d'intégration ordinaire porte `nodeId` nul et n'est
     * pas concernée.
     */
    const bound = request.application.nodeId;
    if (bound !== null && bound !== nodeId) {
      throw new ForbiddenException("Cette clé ne vaut que pour le node auquel elle a été émise.");
    }

    /*
     * Le node est cherché par son identifiant tel qu'il est passé.
     *
     * Un UUID mal formé ne doit pas remonter une erreur de base : PostgreSQL
     * refuse la comparaison et rend un 500, là où l'exploitant qui s'est trompé
     * de node attend qu'on lui dise « inconnu ».
     */
    if (!/^[0-9a-f-]{36}$/i.test(nodeId)) {
      throw new NotFoundException("Node inconnu.");
    }

    const [node] = await this.db
      .select({
        id: nodes.id,
        fqdn: nodes.fqdn,
        scheme: nodes.scheme,
        daemonPort: nodes.daemonPort,
        daemonSftpPort: nodes.daemonSftpPort,
        tokenId: nodes.daemonTokenId,
        tokenEnc: nodes.daemonTokenEnc,
      })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);

    if (!node) throw new NotFoundException("Node inconnu.");

    const configuration = buildWingsNodeConfiguration({
      id: node.id,
      fqdn: node.fqdn,
      scheme: node.scheme,
      daemonPort: node.daemonPort,
      daemonSftpPort: node.daemonSftpPort,
      tokenId: node.tokenId,
      // Chiffré au repos, jamais condensé : le panel doit pouvoir le relire
      // pour parler au daemon, et c'est ici qu'il le rend au daemon lui-même.
      token: decryptSecret(node.tokenEnc),
      /*
       * L'origine vient de la configuration du serveur, jamais de la requête.
       *
       * Un `Host` forgé ferait écrire dans le `config.yml` du daemon l'adresse
       * d'un panel qui n'est pas le nôtre — et le daemon irait ensuite y
       * chercher ses ordres. Wings écrase de toute façon cette valeur par son
       * `--panel-url`, mais rien ne dit qu'il le fera toujours.
       */
      panelOrigin: process.env.PANEL_ORIGIN ?? "http://localhost:3000",
      // La marque de la plateforme : Wings en nomme ses conteneurs, et un
      // exploitant qui lit `docker ps` doit y reconnaître le panel qui pilote
      // sa machine.
      appName: await this.settings.text("brand.name"),
    });

    /*
     * La clé d'amorçage meurt ici, une fois la configuration construite.
     *
     * Après, et non avant : une clé brûlée par une requête qui échoue ensuite
     * laisserait l'exploitant sans rien, avec une commande qu'il ne peut plus
     * rejouer. Attendue, parce qu'un daemon qui aurait reçu sa configuration
     * sans que la clé soit close garderait une porte ouverte.
     */
    if (request.application.singleUse) {
      await this.keys.consume(request.application.keyId);
    }

    return configuration;
  }
}
