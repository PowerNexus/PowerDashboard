import type { Database } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Charge d'un node dans le temps.
 *
 * **Agrégée à la lecture, jamais rangée à part.** La table `node_metrics`
 * existe dans le schéma et elle est restée vide : la remplir reviendrait à
 * écrire une seconde fois ce que `server_metrics` porte déjà, et deux copies
 * d'une même vérité finissent par diverger. La somme se calcule ici, sur des
 * colonnes indexées, et il n'y a rien à tenir à jour.
 *
 * **Ce que ce n'est pas.** Ce n'est pas la charge de la machine : c'est ce que
 * **ses serveurs consomment**. Le système hôte, Docker et tout ce qui tourne à
 * côté n'y figurent pas, et Wings n'offre aucune route qui les donnerait — son
 * `/api/system` ne rend que l'architecture, le noyau et la version. L'écran dit
 * donc « consommé par les serveurs », et non « charge du node » : la nuance
 * décide si l'on croit une machine saturée ou disponible.
 */

/** Fenêtres proposées, et le pas qui va avec. */
const WINDOWS: Record<string, { hours: number; bucketMinutes: number }> = {
  /*
   * Le pas suit la fenêtre.
   *
   * Un pas d'une minute sur sept jours ferait dix mille points pour un graphe
   * large de six cents pixels : dix-sept points par pixel, soit du bruit
   * transmis puis jeté par le navigateur.
   */
  "6h": { hours: 6, bucketMinutes: 5 },
  "24h": { hours: 24, bucketMinutes: 15 },
  "7j": { hours: 24 * 7, bucketMinutes: 120 },
};

export const LOAD_WINDOWS = Object.keys(WINDOWS);

export interface LoadPoint {
  /** Début du pas, en millisecondes. */
  t: number;
  /** Mémoire consommée, en mégaoctets. `null` quand rien n'a été relevé. */
  memoryMb: number | null;
  cpuPct: number | null;
  /** Serveurs relevés sur ce pas : dit si la somme porte sur tout le node. */
  servers: number;
}

@Injectable()
export class NodeLoadService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Série de la charge, un point par pas.
   *
   * Les pas **sans relevé n'apparaissent pas** plutôt que de valoir zéro : une
   * coupure du collecteur ferait sinon un creux dans la courbe, qu'on lirait
   * comme une machine soudain vide. Un trou se voit ; un zéro ment.
   */
  async series(nodeId: string, window: string): Promise<LoadPoint[]> {
    // Fenêtre inconnue : on retombe sur la journée plutôt que de refuser. Le
    // paramètre vient d'une adresse, et un graphe vide pour une faute de frappe
    // n'apprendrait rien à personne.
    const { hours, bucketMinutes } = WINDOWS[window] ?? { hours: 24, bucketMinutes: 15 };
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();

    /*
     * Deux niveaux d'agrégation, et l'ordre compte.
     *
     * D'abord **une valeur par serveur et par pas** — la dernière connue, pas
     * la moyenne : la mémoire consommée est un instantané, et moyenner deux
     * relevés d'un même serveur n'a pas de sens. Ensuite seulement, la somme
     * sur les serveurs du node.
     *
     * L'inverse — sommer d'abord — compterait deux fois un serveur qui a été
     * relevé deux fois dans le même pas, et ferait un pic là où il n'y a qu'une
     * cadence irrégulière.
     */
    /*
     * Écrite en SQL d'un bloc, et non assemblée par l'ORM.
     *
     * Le constructeur de requêtes recopiait l'expression du pas dans le
     * `select` **et** dans le `group by`, et PostgreSQL ne les reconnaissait
     * pas comme identiques : « column must appear in the GROUP BY clause »
     * (42803). Le regroupement par position — `group by 1, 2` — lève
     * l'ambiguïté et rend la requête lisible d'un coup d'œil, ce qui compte
     * pour la seule agrégation un peu dense du projet.
     *
     * Les valeurs variables passent par des paramètres liés, jamais par
     * concaténation : `nodeId` vient d'une adresse.
     */
    const seconds = bucketMinutes * 60;
    const rows = (await this.db.execute(sql`
      select
        to_timestamp(floor(extract(epoch from m.at) / ${seconds}) * ${seconds}) as at,
        m.server_id as "serverId",
        (array_agg(m.mem_bytes order by m.at desc))[1] as "memBytes",
        (array_agg(m.cpu_pct   order by m.at desc))[1] as "cpuPct"
      from server_metrics m
      join servers s on s.id = m.server_id
      where s.node_id = ${nodeId} and m.at >= ${since}
      group by 1, 2
    `)) as unknown as { at: string; serverId: string; memBytes: number; cpuPct: number }[];

    const buckets = new Map<number, { memBytes: number; cpuPct: number; servers: number }>();
    for (const row of rows) {
      const key = new Date(row.at).getTime();
      const current = buckets.get(key) ?? { memBytes: 0, cpuPct: 0, servers: 0 };
      buckets.set(key, {
        memBytes: current.memBytes + Number(row.memBytes ?? 0),
        cpuPct: current.cpuPct + Number(row.cpuPct ?? 0),
        servers: current.servers + 1,
      });
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, sums]) => ({
        t,
        memoryMb: Math.round(sums.memBytes / 1_048_576),
        cpuPct: Math.round(sums.cpuPct * 10) / 10,
        servers: sums.servers,
      }));
  }
}
