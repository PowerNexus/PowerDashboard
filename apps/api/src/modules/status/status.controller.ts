import type { InstatusSummary } from "@gamedashboard/contracts";
import { Controller, Get, Header, Inject } from "@nestjs/common";
import { InstatusService } from "./instatus.service";
import { type StatusReport, StatusService } from "./status.service";

/**
 * Page de statut, côté API.
 *
 * **Sans garde, et c'est tout l'intérêt.** Elle est lue par quelqu'un qui n'y
 * arrive plus : session expirée, connexion refusée, panel inaccessible. Exiger
 * une authentification ferait d'elle une page utile uniquement quand on n'en a
 * pas besoin.
 *
 * Ce qu'elle rend est donc calibré pour être public — un nom de composant, un
 * lieu, un état, et les incidents que l'exploitant a rédigés. Rien qui
 * permette de cartographier l'infrastructure : ni domaine, ni capacité, ni
 * version de daemon, ni nombre de serveurs hébergés.
 */
@Controller("api/v1/status")
export class StatusController {
  constructor(
    @Inject(StatusService) private readonly status: StatusService,
    @Inject(InstatusService) private readonly instatus: InstatusService,
  ) {}

  /**
   * `s-maxage` de dix secondes : l'incident qui fait affluer le monde sur cette
   * page est aussi celui qui la rend la plus consultée. Dix secondes bornent la
   * charge sans que l'information paraisse figée — et la réponse porte son
   * horodatage, pour que le lecteur sache de quand elle date.
   *
   * `stale-while-revalidate` : mieux vaut servir une page de dix secondes de
   * retard que faire attendre pendant qu'on la recalcule.
   */
  @Get()
  @Header("cache-control", "public, max-age=0, s-maxage=10, stale-while-revalidate=30")
  async report(): Promise<{ data: StatusReport }> {
    return { data: await this.status.report() };
  }

  /**
   * Ce que la page Instatus annonce, relayé pour la bannière du panel.
   *
   * Servi ici, sans garde, et non parmi les lectures du client : ce qu'on
   * relaie est déjà public sur la page d'Instatus, et une bannière de
   * maintenance n'a aucune raison de dépendre d'une session — celle qui
   * prévient d'une coupure doit s'afficher aussi sur l'écran de connexion.
   *
   * Cache identique à celui du rapport : le service garde déjà le résumé une
   * minute, cet en-tête évite en plus l'aller-retour depuis le rendu.
   */
  @Get("notice")
  @Header("cache-control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60")
  async notice(): Promise<{ data: InstatusSummary }> {
    return { data: await this.instatus.summary() };
  }
}
