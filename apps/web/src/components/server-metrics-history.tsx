"use client";

import {
  METRICS_RANGES,
  type MetricsHistoryPoint,
  type MetricsRange,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  formatBytes,
  type Point,
  Skeleton,
  SparkChart,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@gamedashboard/ui";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMetricsHistory } from "@/lib/use-metrics-history";
import type { ClientServer } from "@/server/api/client";

/** Extrait une courbe de la série. `null` reste `null` : c'est un trou, pas un zéro. */
function courbe(
  points: MetricsHistoryPoint[],
  lire: (p: MetricsHistoryPoint) => number | null,
): Point[] {
  return points.map((p, t) => ({ t, v: lire(p) }));
}

const MO = 1024 * 1024;
const enMo = (v: number | null) => (v === null ? null : v / MO);

/**
 * Historique des mesures : 1 h, 24 h, 7 j ou 30 j.
 *
 * Il vit **sur la console**, sous les graphes en direct, plutôt que dans un
 * onglet à part : c'est là qu'on regarde la consommation, et « le serveur rame
 * depuis quand ? » se pose en voyant la courbe du moment. Un onglet de plus
 * aurait séparé la question de sa réponse.
 *
 * Moyenne pleine, maximum en pointillés, et **les trous restent des trous** :
 * un serveur arrêté ou une machine muette ne laissent aucune mesure, et
 * l'écran le montre plutôt que de dessiner un serveur au repos.
 */
export function ServerMetricsHistory({ server }: { server: ClientServer }) {
  const t = useTranslations("metricsHistory");
  const { range, setRange, history, error, pending } = useMetricsHistory(server.id);
  const points = history?.points ?? [];
  const rien = history !== null && points.every((p) => p.samples === 0);
  const joueurs = points.some((p) => p.playersMax !== null);
  const debit = (v: number) => `${formatBytes(v)}/s`;

  return (
    <Card>
      <CardHeader
        icon={<History />}
        title={t("title")}
        description={t("description")}
        actions={
          <Tabs
            value={range}
            defaultValue={range}
            onValueChange={(v) => setRange(v as MetricsRange)}
          >
            <TabsList variant="pill">
              {METRICS_RANGES.map((r) => (
                <TabsTrigger key={r} value={r}>
                  {t(`range.${r}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {error ? (
          <AlertBanner variant="warning" title={t("unavailable")}>
            {error}
          </AlertBanner>
        ) : history === null ? (
          pending ? (
            <Skeleton className="h-[200px] w-full" />
          ) : null
        ) : rien ? (
          <EmptyState icon={<History />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2" aria-busy={pending}>
            <SparkChart
              title={t("cpu")}
              ranges={[]}
              data={courbe(points, (p) => p.cpuAvgPct)}
              peak={courbe(points, (p) => p.cpuMaxPct)}
              max={server.cpuMaxPct > 0 ? server.cpuMaxPct : undefined}
              unit=" %"
              format={(v) => v.toFixed(1)}
            />
            <SparkChart
              title={t("memory")}
              ranges={[]}
              data={courbe(points, (p) => enMo(p.memoryAvgBytes))}
              peak={courbe(points, (p) => enMo(p.memoryMaxBytes))}
              max={server.memoryMaxMb > 0 ? server.memoryMaxMb : undefined}
              format={(v) => formatBytes(v * MO)}
            />
            <SparkChart
              title={t("disk")}
              ranges={[]}
              data={courbe(points, (p) => enMo(p.diskBytes))}
              max={server.diskMaxMb > 0 ? server.diskMaxMb : undefined}
              format={(v) => formatBytes(v * MO)}
            />
            <SparkChart
              title={t("network")}
              subtitle={t("networkHint")}
              ranges={[]}
              data={courbe(points, (p) => p.networkRxBytesPerSec)}
              peak={courbe(points, (p) => p.networkTxBytesPerSec)}
              format={debit}
            />
            {joueurs ? (
              <SparkChart
                title={t("players")}
                ranges={[]}
                data={courbe(points, (p) => p.playersAvg)}
                peak={courbe(points, (p) => p.playersMax)}
                format={(v) => v.toFixed(0)}
              />
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
