import {
  type IncidentImpact,
  type IncidentState,
  type IncidentUpdate,
  isIncidentImpact,
  isIncidentState,
} from "@gamedashboard/contracts";
import { type Database, incidents, nodes } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { desc, eq, inArray } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

export interface AdminIncident {
  id: string;
  title: string;
  state: IncidentState;
  impact: IncidentImpact;
  nodeIds: string[];
  updates: IncidentUpdate[];
  startedAt: string;
  resolvedAt: string | null;
}

/**
 * Rédaction des incidents.
 *
 * Ce que le heartbeat ne sait pas dire : pourquoi, pour combien de temps, et ce
 * qu'on fait. La page publique montre l'état observé même sans incident rédigé
 * — celui-ci ajoute le récit, il ne remplace pas l'observation.
 *
 * Le journal d'un incident est **en ajout seul** : on publie une mise à jour,
 * on ne réécrit pas les précédentes. Un historique qu'on peut retoucher ne
 * prouve rien, et c'est précisément ce qu'un client relit quand il veut savoir
 * si on l'a prévenu à temps.
 */
@Injectable()
export class IncidentsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async all(): Promise<AdminIncident[]> {
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
      .orderBy(desc(incidents.createdAt));

    return rows.map((row) => ({ ...row, updates: (row.updates as IncidentUpdate[]) ?? [] }));
  }

  /**
   * Ouvre un incident, avec sa première mise à jour.
   *
   * Le corps du premier message est exigé : un incident publié sans un mot
   * n'apprend rien à personne, et la page afficherait un titre suivi du vide au
   * moment où l'on compte le plus sur elle.
   */
  async open(input: {
    title: string;
    impact: string;
    nodeIds: string[];
    body: string;
  }): Promise<AdminIncident> {
    const title = input.title.trim();
    if (title === "") throw new BadRequestException("Un incident a besoin d'un titre.");

    const body = input.body.trim();
    if (body === "") {
      throw new BadRequestException(
        "Écrivez une première mise à jour : ce que vous savez, et quand.",
      );
    }

    if (!isIncidentImpact(input.impact)) {
      throw new BadRequestException(`Impact inconnu : « ${input.impact} ».`);
    }

    await this.assertNodesExist(input.nodeIds);

    const first: IncidentUpdate = {
      state: "investigating",
      body,
      at: new Date().toISOString(),
    };

    const [created] = await this.db
      .insert(incidents)
      .values({
        title,
        impact: input.impact,
        status: "investigating",
        nodeIds: [...new Set(input.nodeIds)],
        updates: [first],
      })
      .returning({ id: incidents.id });

    if (!created) throw new BadRequestException("L'incident n'a pas pu être créé.");
    return this.byId(created.id);
  }

  /**
   * Publie une mise à jour et fait avancer l'état.
   *
   * L'état vit à deux endroits — sur la ligne et dans la dernière mise à jour —
   * et c'est voulu : la colonne sert aux requêtes, le journal sert à relire la
   * chronologie. Les écrire ensemble, ici et nulle part ailleurs, est ce qui
   * les empêche de diverger.
   *
   * `resolved` clôt l'incident dans le même geste : un incident dont la
   * dernière mise à jour annonce la résolution mais qui reste ouvert sur la
   * page publique est la façon la plus sûre de perdre la confiance qu'on
   * essayait de gagner.
   */
  async update(incidentId: string, input: { state: string; body: string }): Promise<AdminIncident> {
    const body = input.body.trim();
    if (body === "")
      throw new BadRequestException("Une mise à jour sans texte n'informe personne.");
    if (!isIncidentState(input.state)) {
      throw new BadRequestException(`État inconnu : « ${input.state} ».`);
    }

    const current = await this.byId(incidentId);
    if (current.resolvedAt) {
      throw new BadRequestException(
        "Cet incident est clos. Ouvrez-en un nouveau plutôt que de rouvrir celui-ci.",
      );
    }

    const now = new Date().toISOString();
    const entry: IncidentUpdate = { state: input.state, body, at: now };

    await this.db
      .update(incidents)
      .set({
        status: input.state,
        // Ajout en fin de liste : les mises à jour existantes ne sont jamais
        // relues ni réécrites.
        updates: [...current.updates, entry],
        resolvedAt: input.state === "resolved" ? now : null,
        updatedAt: now,
      })
      .where(eq(incidents.id, incidentId));

    return this.byId(incidentId);
  }

  async byId(incidentId: string): Promise<AdminIncident> {
    const [row] = await this.db
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
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!row) throw new NotFoundException("Incident introuvable.");
    return { ...row, updates: (row.updates as IncidentUpdate[]) ?? [] };
  }

  /**
   * Un incident peut viser aucun node.
   *
   * Toutes les pannes ne sont pas matérielles : une panne de facturation ou de
   * SSO n'a pas de node à désigner, et refuser une liste vide obligerait à en
   * choisir un au hasard pour pouvoir prévenir les clients.
   */
  private async assertNodesExist(nodeIds: string[]): Promise<void> {
    if (nodeIds.length === 0) return;

    const found = await this.db
      .select({ id: nodes.id })
      .from(nodes)
      .where(inArray(nodes.id, nodeIds));

    if (found.length !== new Set(nodeIds).size) {
      throw new BadRequestException("Un des composants désignés n'existe pas.");
    }
  }
}
