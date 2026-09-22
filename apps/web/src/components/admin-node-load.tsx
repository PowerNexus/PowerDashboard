"use client";

import { AlertBanner, Dialog, DialogContent, EmptyState, SparkChart } from "@gamedashboard/ui";
import { Activity } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { loadNodeSeries, type NodeLoadPoint } from "@/server/api/admin-actions";

/**
 * Courbe de charge d'une machine.
 *
 * **Ce qui est tracé, c'est ce que les serveurs consomment**, et non la charge
 * de la machine : le système hôte, Docker et tout ce qui tourne à côté n'y
 * figurent pas — Wings n'offre aucune route qui les donnerait. Le titre le dit,
 * parce que la nuance décide si l'on croit une machine saturée ou disponible.
 *
 * La série est **calculée** à la lecture depuis les relevés par serveur ; rien
 * n'est rangé à part. Une seconde table de mesures par node aurait fini par
 * diverger de celle dont elle est tirée.
 */
const WINDOWS = ["6h", "24h", "7j"];

export function AdminNodeLoad({
  node,
  onClose,
}: {
  node: { id: string; name: string };
  onClose: () => void;
}) {
  const t = useTranslations("nodeLoad");
  const tc = useTranslations("common");
  const [window_, setWindow] = useState("24h");
  const [points, setPoints] = useState<NodeLoadPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(
    (range: string) =>
      startTransition(async () => {
        const result = await loadNodeSeries(node.id, range);
        setError(result.error);
        setPoints(result.points);
      }),
    [node.id],
  );

  useEffect(() => {
    load(window_);
  }, [load, window_]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" title={t("title", { name: node.name })} description={t("hint")}>
        <div className="flex flex-col gap-4">
          {error ? (
            <AlertBanner variant="danger" title={tc("actionRefused")}>
              {error}
            </AlertBanner>
          ) : null}

          {points.length === 0 && !pending ? (
            /*
             * Aucun point : ce n'est pas une machine à l'arrêt.
             *
             * Le relevé tourne à la minute et ne garde qu'un mois : un node
             * déclaré ce matin, ou dont les serveurs n'ont jamais démarré, n'a
             * simplement rien à montrer. Un graphe plat à zéro dirait le
             * contraire.
             */
            <EmptyState icon={<Activity />} title={t("emptyTitle")} description={t("emptyBody")} />
          ) : (
            <>
              <SparkChart
                title={t("memory")}
                subtitle={t("measured", { count: points.at(-1)?.servers ?? 0 })}
                data={points.map((p) => ({ t: p.t, v: p.memoryMb ?? 0 }))}
                unit=" Mo"
                ranges={WINDOWS}
                range={window_}
                onRangeChange={setWindow}
                format={(v) => v.toFixed(0)}
              />

              <SparkChart
                title={t("cpu")}
                data={points.map((p) => ({ t: p.t, v: p.cpuPct ?? 0 }))}
                unit=" %"
                ranges={WINDOWS}
                range={window_}
                onRangeChange={setWindow}
                format={(v) => v.toFixed(1)}
              />
            </>
          )}

          {/* Dit sous le graphe, où on vient de lire des chiffres : ce sont
              ceux des serveurs, pas ceux de la machine. */}
          <p className="text-faint text-xs">{t("scope")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
