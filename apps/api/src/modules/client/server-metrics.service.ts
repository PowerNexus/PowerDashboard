import {
  type MetricsHistory,
  type MetricsHistoryPoint,
  type MetricsRange,
  metricsBuckets,
} from "@gamedashboard/contracts";
import type { Database } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Écart au-delà duquel deux relevés successifs ne donnent plus de débit.
 *
 * Le relevé passe chaque minute ; deux minutes et demie laissent la place à un
 * tour en retard. Au-delà, il manque au moins un relevé : diviser l'écart des
 * compteurs par vingt minutes de silence donnerait un débit moyen lissé sur une
 * période qu'on n'a pas observée, dessiné comme s'il l'avait été.
 */
const NETWORK_MAX_GAP_SECONDS = 150;

/**
 * Historique des mesures d'un serveur, lu dans `server_metrics`.
 *
 * Distinct du relais `resources` : celui-là demande l'instant présent à Wings,
 * celui-ci relit ce que le panel a déjà relevé. Il ne touche jamais au daemon,
 * et répond donc même quand le node est tombé — c'est justement là qu'on veut
 * voir quand les mesures se sont arrêtées.
 *
 * **L'agrégation se fait en SQL**, et pas par commodité : trente jours d'un
 * serveur font 43 200 lignes. Les rapatrier pour en faire 180 moyennes en
 * mémoire ferait transiter deux cents fois trop de données à chaque
 * ouverture de la console.
 */
@Injectable()
export class ServerMetricsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async history(
    serverId: string,
    range: MetricsRange,
    now: Date = new Date(),
  ): Promise<MetricsHistory> {
    const { first, last, stepSeconds } = metricsBuckets(range, now);

    /*
     * Trois étapes, chacune pour une raison.
     *
     * 1. `releves` lit les lignes de la plage — l'index
     *    `server_metric_server_at_idx (server_id, at)` les borne — et calcule
     *    les écarts de compteurs réseau. Wings rapporte des octets **cumulés**
     *    depuis le démarrage du conteneur : le débit est une différence entre
     *    deux relevés, jamais une valeur lue. La fenêtre remonte de quelques
     *    minutes avant le premier pas pour que son premier relevé ait un
     *    prédécesseur.
     *
     * 2. `pas` agrège par `date_bin`, aligné sur l'époque comme
     *    `metricsBuckets` : les deux doivent tomber sur les mêmes bornes.
     *
     * 3. `generate_series` rend **tous** les pas, et la jointure externe laisse
     *    nuls ceux qui n'ont rien reçu. Un pas absent de la réponse serait
     *    indiscernable d'un pas voisin pour qui trace la courbe : il faut que
     *    le trou soit écrit pour être vu.
     *
     * Ce qui compte comme mesure :
     *
     * - **Serveur arrêté** (`offline`) : Wings répond, avec des zéros. Ce
     *   n'est pas une charge nulle, c'est l'absence de programme. Le processeur,
     *   la mémoire, le réseau et les joueurs de ces relevés sont écartés, et le
     *   pas reste un trou. Le **disque**, lui, existe serveur arrêté et Wings
     *   le mesure sur le volume : il est gardé.
     * - **Compteur remis à zéro** (redémarrage du conteneur) : l'écart est
     *   négatif, et n'est pas un débit. Écarté.
     * - **Relevés trop espacés** : voir `NETWORK_MAX_GAP_SECONDS`.
     *
     * Les colonnes d'octets sont des `integer` : elles sont converties en
     * `float8` avant tout calcul, pour qu'une somme ou une différence ne
     * déborde pas, et que le pilote rende des nombres et non des chaînes.
     */
    const rows = (await this.db.execute(sql`
      with releves as (
        select
          m.at,
          m.state <> 'offline' as actif,
          m.cpu_pct::float8 as cpu,
          m.mem_bytes::float8 as memoire,
          m.disk_bytes::float8 as disque,
          m.players,
          m.net_rx::float8 - lag(m.net_rx::float8) over w as ecart_rx,
          m.net_tx::float8 - lag(m.net_tx::float8) over w as ecart_tx,
          extract(epoch from m.at - lag(m.at) over w)::float8 as ecart_s,
          coalesce(lag(m.state) over w <> 'offline', false) as precedent_actif
        from server_metrics m
        where m.server_id = ${serverId}
          and m.at >= ${first.toISOString()}::timestamptz - make_interval(secs => ${NETWORK_MAX_GAP_SECONDS})
          and m.at <= ${now.toISOString()}::timestamptz
        window w as (order by m.at)
      ),
      debits as (
        select
          *,
          case
            when actif and precedent_actif and ecart_s > 0 and ecart_s <= ${NETWORK_MAX_GAP_SECONDS}
              and ecart_rx >= 0 then ecart_rx / ecart_s
          end as rx,
          case
            when actif and precedent_actif and ecart_s > 0 and ecart_s <= ${NETWORK_MAX_GAP_SECONDS}
              and ecart_tx >= 0 then ecart_tx / ecart_s
          end as tx
        from releves
        where at >= ${first.toISOString()}::timestamptz
      ),
      pas as (
        select
          date_bin(make_interval(secs => ${stepSeconds}), at, 'epoch'::timestamptz) as debut,
          count(*)::int as samples,
          avg(cpu) filter (where actif) as cpu_moy,
          max(cpu) filter (where actif) as cpu_max,
          avg(memoire) filter (where actif) as mem_moy,
          max(memoire) filter (where actif) as mem_max,
          max(disque) as disque,
          avg(rx) as rx,
          avg(tx) as tx,
          avg(players::float8) filter (where actif) as joueurs_moy,
          max(players) filter (where actif) as joueurs_max
        from debits
        group by 1
      )
      select
        to_char(g.debut at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "at",
        coalesce(p.samples, 0) as "samples",
        p.cpu_moy as "cpuAvgPct",
        p.cpu_max as "cpuMaxPct",
        p.mem_moy as "memoryAvgBytes",
        p.mem_max as "memoryMaxBytes",
        p.disque as "diskBytes",
        p.rx as "networkRxBytesPerSec",
        p.tx as "networkTxBytesPerSec",
        p.joueurs_moy as "playersAvg",
        p.joueurs_max as "playersMax"
      from generate_series(
        ${first.toISOString()}::timestamptz,
        ${last.toISOString()}::timestamptz,
        make_interval(secs => ${stepSeconds})
      ) as g(debut)
      left join pas p on p.debut = g.debut
      order by g.debut
    `)) as unknown as MetricsHistoryPoint[];

    return {
      range,
      stepSeconds,
      from: first.toISOString(),
      to: now.toISOString(),
      points: rows.map((row) => ({ ...row })),
    };
  }
}
