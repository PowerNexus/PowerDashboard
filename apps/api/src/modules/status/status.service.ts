import {
  componentStateOf,
  type IncidentImpact,
  type IncidentState,
  type IncidentUpdate,
  NODE_HEARTBEAT_LOST_MS,
  type PlatformState,
  platformState,
} from "@gamedashboard/contracts";
import { type Database, incidents, locations, nodes } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Un composant de la page publique.
 *
 * Volontairement pauvre : un nom, un lieu, un état. Ni domaine, ni capacité,
 * ni nombre de serveurs. Rendre une page publique ne doit pas rendre publiques
 * les informations qu'elle affichait à des gens connectés — sans quoi
 * l'ouverture au public devient une cartographie de l'infrastructure offerte à
 * qui la convoite.
 */
export interface StatusComponent {
  id: string;
  name: string;
  location: string;
  state: PlatformState;
}

export interface StatusIncident {
  id: string;
  title: string;
  state: IncidentState;
  impact: IncidentImpact;
  /** Noms des composants touchés. Les identifiants ne diraient rien au lecteur. */
  components: string[];
  updates: IncidentUpdate[];
  startedAt: string;
  resolvedAt: string | null;
}

export interface StatusReport {
  state: PlatformState;
  components: StatusComponent[];
  openIncidents: StatusIncident[];
  /** Incidents clos récents. L'historique existant, pas un historique inventé. */
  recentIncidents: StatusIncident[];
  /** Instant de la lecture : une page de statut mise en cache doit dire son âge. */
  at: string;
}

/** Au-delà, l'historique n'informe plus : il archive. */
const HISTORY_LIMIT = 10;

/**
 * La page de statut, telle que l'extérieur la voit.
 *
 * Deux sources, et une règle entre elles : l'observation prime. L'état des
 * composants est **déduit** du heartbeat, donc personne ne peut afficher « tout
 * va bien » sur un parc muet. Les incidents rédigés viennent par-dessus pour
 * raconter ce que la machine ne sait pas dire — la cause, l'échéance, ce qu'on
 * fait.
 *
 * Aucune disponibilité chiffrée n'est calculée : elle demanderait un historique
 * d'états que le panel ne conserve pas. Un « 99,98 % » plausible mais faux sur
 * une page de statut coûte plus cher que son absence.
 */
@Injectable()
export class StatusService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async report(): Promise<StatusReport> {
    const [components, open, recent] = await Promise.all([
      this.components(),
      this.incidents({ open: true }),
      this.incidents({ open: false }),
    ]);

    return {
      state: platformState({
        components: components.map((component) => component.state),
        openIncidents: open.map((incident) => incident.impact),
      }),
      components,
      openIncidents: open,
      recentIncidents: recent,
      at: new Date().toISOString(),
    };
  }

  /**
   * Les composants publics : les nodes de la plateforme.
   *
   * Ceux d'un revendeur en sont exclus. Ils n'appartiennent pas à la
   * plateforme, leur indisponibilité ne concerne que les clients de ce
   * revendeur, et les afficher ici reviendrait à publier l'état d'un parc dont
   * nous ne répondons pas.
   */
  private async components(): Promise<StatusComponent[]> {
    const rows = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        location: locations.long,
        maintenance: nodes.maintenanceMode,
        lastHeartbeatAt: nodes.lastHeartbeatAt,
      })
      .from(nodes)
      .innerJoin(locations, eq(nodes.locationId, locations.id))
      .where(isNull(nodes.ownerId))
      .orderBy(locations.long, nodes.name);

    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      state: componentStateOf({
        maintenance: row.maintenance,
        lastHeartbeatAt: row.lastHeartbeatAt,
        lostAfterMs: NODE_HEARTBEAT_LOST_MS,
        now,
      }),
    }));
  }

  private async incidents(filter: { open: boolean }): Promise<StatusIncident[]> {
    const rows = await this.db
      .select({
        id: incidents.id,
        title: incidents.title,
        state: incidents.status,
        impact: incidents.impact,
        nodeIds: incidents.nodeIds,
        updates: incidents.updates,
        startedAt: incidents.createdAt,
        resolvedAt: incidents.resolvedAt,
      })
      .from(incidents)
      .where(filter.open ? isNull(incidents.resolvedAt) : sql`${incidents.resolvedAt} is not null`)
      .orderBy(desc(incidents.createdAt))
      .limit(filter.open ? 50 : HISTORY_LIMIT);

    if (rows.length === 0) return [];

    // Les noms sont résolus en une seule lecture, pas une par incident : la
    // page est publique, donc exposée à des rafraîchissements en rafale le jour
    // où elle sert le plus.
    const names = await this.nodeNames();

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      state: row.state,
      impact: row.impact,
      // Un node supprimé depuis l'incident disparaît de la liste plutôt que
      // d'afficher un identifiant nu, qui n'apprendrait rien.
      components: row.nodeIds.map((id) => names.get(id)).filter((n): n is string => Boolean(n)),
      updates: (row.updates as IncidentUpdate[]) ?? [],
      startedAt: row.startedAt,
      resolvedAt: row.resolvedAt,
    }));
  }

  private async nodeNames(): Promise<Map<string, string>> {
    const rows = await this.db.select({ id: nodes.id, name: nodes.name }).from(nodes);
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
