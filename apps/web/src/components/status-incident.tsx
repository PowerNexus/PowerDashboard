import type { IncidentImpact, IncidentState } from "@gamedashboard/contracts";
import { Badge, Card, CardBody, CardHeader, RelativeTime } from "@gamedashboard/ui";
import { getTranslations } from "next-intl/server";
import type { StatusIncident } from "@/server/api/status";

/** La gravité annoncée, et sa couleur. `none` n'alarme pas : c'est son rôle. */
const IMPACT_TONE: Record<IncidentImpact, "neutral" | "warning" | "danger"> = {
  none: "neutral",
  minor: "warning",
  major: "danger",
  critical: "danger",
};

/** Un incident clos ne s'affiche pas comme un incident en cours. */
const STATE_TONE: Record<IncidentState, "neutral" | "warning" | "success"> = {
  investigating: "warning",
  identified: "warning",
  monitoring: "warning",
  resolved: "success",
};

/**
 * Un incident, avec son fil de mises à jour.
 *
 * Le fil est rendu du **plus récent au plus ancien** : celui qui ouvre la page
 * pendant la panne veut la dernière nouvelle, pas le premier message. Il lira
 * la suite s'il veut la chronologie.
 *
 * Chaque entrée porte son heure. C'est ce qu'un client relit des mois plus tard
 * pour savoir s'il a été prévenu à temps, et c'est la raison pour laquelle ce
 * journal ne se réécrit jamais.
 */
export async function StatusIncidentCard({ incident }: { incident: StatusIncident }) {
  const t = await getTranslations("status");

  const timeline = [...incident.updates].reverse();

  return (
    <Card>
      <CardHeader
        title={incident.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={IMPACT_TONE[incident.impact]}>{t(`impact.${incident.impact}`)}</Badge>
            <Badge variant={STATE_TONE[incident.state]}>
              {t(`incidentState.${incident.state}`)}
            </Badge>
            <span className="text-muted text-xs">
              {t("since")} <RelativeTime value={incident.startedAt} />
            </span>
            {incident.components.length > 0 ? (
              <span className="text-muted text-xs">· {incident.components.join(", ")}</span>
            ) : null}
          </span>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {timeline.map((update) => (
          <div
            key={`${update.at}-${update.state}`}
            className="border-border border-l-2 pl-4 first:border-accent"
          >
            <p className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-fg">{t(`incidentState.${update.state}`)}</span>
              <RelativeTime className="text-faint" value={update.at} />
            </p>
            <p className="mt-1 text-fg text-sm">{update.body}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
