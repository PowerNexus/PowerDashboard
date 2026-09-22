import { AlertBanner, Badge, Card, CardBody, CardHeader, formatRelative } from "@gamedashboard/ui";
import { getTranslations } from "next-intl/server";
import type { RetentionReport } from "@/server/api/admin";

/**
 * Ce que l'entretien de la base a fait, et ce qu'il garde.
 *
 * Cet écran existe parce que le service était **muet**. Il ne journalisait que
 * lorsqu'il effaçait quelque chose : sur une plateforme jeune, où rien n'a
 * encore l'âge d'être retiré, il n'écrivait jamais une ligne. Impossible de
 * dire s'il tournait, s'il échouait en boucle, ou si son minuteur n'avait
 * jamais été armé — et on ne l'aurait découvert qu'au disque plein.
 *
 * Les fenêtres de conservation sont affichées avec l'état, et pas seulement
 * l'état : savoir que le ménage tourne ne sert qu'à moitié si l'on ignore ce
 * qu'il garde et combien de temps. C'est la seule question qu'on se pose
 * vraiment devant cet écran — « mes journaux d'il y a six mois sont-ils encore
 * là ? ».
 */
export async function AdminRetention({ report }: { report: RetentionReport }) {
  const t = await getTranslations("retention");

  /*
   * Un tour raté est sans gravité, dix d'affilée sont une panne.
   *
   * Le premier se rattrape à l'heure suivante ; la répétition signifie que
   * plus rien n'est effacé depuis des heures, et ce n'est plus la même
   * nouvelle. Le compteur porte donc la différence, pas l'existence de
   * l'erreur.
   */
  const severe = (report.failure?.consecutive ?? 0) >= 3;

  return (
    <Card>
      <CardHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          report.failure ? (
            <Badge variant={severe ? "danger" : "warning"}>{t("stateFailing")}</Badge>
          ) : report.lastSuccessAt ? (
            <Badge variant="success">{t("stateHealthy")}</Badge>
          ) : (
            // Ni sain ni en panne : il n'a simplement pas encore eu lieu. Le
            // premier tour part une minute après le démarrage.
            <Badge variant="neutral">{t("statePending")}</Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        {report.failure ? (
          <AlertBanner
            variant={severe ? "danger" : "warning"}
            title={t("failureTitle", { count: report.failure.consecutive })}
          >
            {report.failure.message}
          </AlertBanner>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact
            label={t("lastRun")}
            value={
              report.lastSuccessAt
                ? formatRelative(report.lastSuccessAt)
                : /* « Jamais » et « zéro ligne » sont deux choses différentes :
                     la première dit qu'on ne sait rien encore. */
                  t("never")
            }
            hint={report.durationMs === null ? undefined : t("duration", { ms: report.durationMs })}
          />
          <Fact
            label={t("nextRun")}
            value={report.nextRunAt ? formatRelative(report.nextRunAt) : t("unknown")}
            hint={t("everyHour")}
          />
          <Fact
            label={t("lastRemoved")}
            value={report.lastRemoved.toLocaleString("fr-FR")}
            hint={t("lastRemovedHint")}
          />
          <Fact
            label={t("totalRemoved")}
            value={report.totalRemoved.toLocaleString("fr-FR")}
            hint={t("totalRemovedHint")}
          />
        </dl>

        <div className="flex flex-col divide-y divide-border">
          {report.tables.map((entry) => (
            <div
              key={entry.table}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
            >
              <span className="gd-mono text-sm font-semibold text-fg">{entry.table}</span>
              <Badge variant="neutral">{t("window", { days: entry.days })}</Badge>
              <span className="ml-auto text-sm text-muted">
                {entry.rows > 0
                  ? t("removedRows", { count: entry.rows })
                  : /* Zéro n'est pas un échec : c'est une table où rien n'avait
                       l'âge d'être retiré. Le dire explicitement évite de lire
                       une absence comme une panne. */
                    t("nothingToRemove")}
              </span>
              <p className="w-full text-xs text-faint">{entry.reason}</p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-fg">{value}</dd>
      {hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}
