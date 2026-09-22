import { type Database, locations, nodes, servers } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Vue publique du parc, pour la page de statut.
 *
 * Volontairement restreinte : ni nom de domaine réel, ni jeton, ni version du
 * daemon. Un client doit pouvoir constater qu'un node est en panne — il n'a pas
 * à pouvoir cartographier l'infrastructure ni connaître la version exacte à
 * attaquer.
 */
@Injectable()
export class ClientNodesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async publicNodes() {
    const rows = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        category: nodes.category,
        subcategory: nodes.subcategory,
        location: locations.short,
        memoryMb: nodes.memoryMb,
        diskMb: nodes.diskMb,
        cpuCores: nodes.cpuCores,
        maintenance: nodes.maintenanceMode,
        lastHeartbeatAt: nodes.lastHeartbeatAt,
        servers: count(servers.id),
      })
      .from(nodes)
      .innerJoin(locations, eq(nodes.locationId, locations.id))
      .leftJoin(servers, eq(servers.nodeId, nodes.id))
      // Un node privé n'apparaît pas : il n'est pas destiné aux clients.
      .where(eq(nodes.public, true))
      .groupBy(nodes.id, locations.short)
      .orderBy(nodes.name);

    return rows.map((row) => ({
      ...row,
      // Champs attendus par l'affichage mais non divulgués.
      fqdn: "",
      wingsVersion: null,
      allocatedMemoryMb: 0,
    }));
  }
}
