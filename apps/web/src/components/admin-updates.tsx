import type { UpdateStatus } from "@gamedashboard/contracts";
import { AlertBanner, Badge, Card, CardBody, CardHeader, formatRelative } from "@gamedashboard/ui";
import { getTranslations } from "next-intl/server";
import { AdminUpdatesActions } from "./admin-updates-actions";

/**
 * La mise à jour autonome, telle que le panel la voit (hébergement cPanel).
 *
 * Rien ne s'affiche ailleurs : sur un serveur à soi, la mise à jour passe par
 * `gamedashboard update`, et une carte vide ferait chercher un réglage qui
 * n'existe pas.
 */
export async function AdminUpdates({ status }: { status: UpdateStatus }) {
  if (!status.actif) return null;
  const t = await getTranslations("adminUpdates");
  const { operation, dernierResultat: resultat } = status;

  const disponible =
    status.derniereRelease !== null &&
    status.derniereRelease !== status.enService &&
    !status.refusees.includes(status.derniereRelease);
  const [variante, etat] = operation
    ? (["info", t("stateRunning")] as const)
    : resultat && resultat.etat !== "installee" && resultat.version === status.derniereRelease
      ? (["danger", t("stateFailed")] as const)
      : disponible
        ? (["warning", t("stateAvailable")] as const)
        : (["success", t("stateUpToDate")] as const);

  return (
    <Card>
      <CardHeader
        title={t("title")}
        description={t("subtitle")}
        actions={<Badge variant={variante}>{etat}</Badge>}
      />
      <CardBody className="flex flex-col gap-4">
        {operation ? (
          <AlertBanner variant="info" title={t(`step${capitaliser(operation.etape)}`, operation)}>
            {formatRelative(operation.depuis)}
          </AlertBanner>
        ) : resultat?.etat === "installee" ? (
          <AlertBanner variant="success" title={t("resultInstalled", resultat)}>
            {formatRelative(resultat.date)}
          </AlertBanner>
        ) : resultat ? (
          <AlertBanner
            variant={resultat.etat === "refusee" ? "danger" : "warning"}
            title={t(
              resultat.etat === "refusee" ? "resultRefusedTitle" : "resultErrorTitle",
              resultat,
            )}
          >
            <span className="whitespace-pre-line">{resultat.message}</span>
            {resultat.etat === "erreur" ? <p className="mt-1">{t("resultErrorHint")}</p> : null}
          </AlertBanner>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fait label={t("inService")} value={status.enService} />
          <Fait label={t("latest")} value={status.derniereRelease ?? t("latestUnknown")} />
          <Fait
            label={t("lastCheck")}
            value={
              status.derniereVerification ? formatRelative(status.derniereVerification) : t("never")
            }
          />
          <Fait label={t("previous")} value={status.precedente ?? t("previousNone")} />
        </dl>

        {status.refusees.length > 0 ? (
          <p className="text-muted text-sm">
            {t("refused", { versions: status.refusees.join(", ") })}
          </p>
        ) : null}

        <AdminUpdatesActions
          busy={operation !== null}
          current={status.enService}
          previous={status.precedente}
        />
      </CardBody>
    </Card>
  );
}

function Fait({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="gd-mono mt-1 text-fg">{value}</dd>
    </div>
  );
}

function capitaliser(etape: string): string {
  return etape.charAt(0).toUpperCase() + etape.slice(1);
}
