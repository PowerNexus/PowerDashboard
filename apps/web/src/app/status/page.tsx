import type { PlatformState } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Brand,
  Card,
  CardBody,
  CardHeader,
  PageTemplate,
  RelativeTime,
  StatTile,
  StatusDot,
} from "@gamedashboard/ui";
import { CheckCircle2, CircleSlash, Clock, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { StatusIncidentCard } from "@/components/status-incident";
import { StatusUptime } from "@/components/status-uptime";
import { getBranding } from "@/server/api/branding";
import { fetchStatus } from "@/server/api/status";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("status");
  return { title: t("metaTitle") };
}

/**
 * Jamais mise en cache par Next.
 *
 * Une page de statut servie depuis un cache de build annoncerait « tout va
 * bien » pendant une panne — le seul moment où quelqu'un la lit. La réponse de
 * l'API porte, elle, un `s-maxage` de dix secondes : le cache est décidé là où
 * la fraîcheur est connue, pas ici.
 */
export const dynamic = "force-dynamic";

/** Ton et icône par état, du calme à l'alarme. */
const STATE_TONE: Record<PlatformState, "success" | "warning" | "danger"> = {
  operational: "success",
  maintenance: "warning",
  degraded: "warning",
  down: "danger",
};

/**
 * Page de statut publique.
 *
 * Elle vit **hors** du panel : pas de coquille, pas de barre latérale, pas de
 * session. C'est la seule page du produit qu'on doit pouvoir lire quand rien
 * d'autre ne répond, et une dépendance à l'authentification la rendrait
 * inutilisable exactement quand elle sert.
 */
export default async function StatusPage() {
  const t = await getTranslations("status");
  const report = await fetchStatus();
  const branding = await getBranding();

  const counts = {
    operational: report.components.filter((c) => c.state === "operational").length,
    maintenance: report.components.filter((c) => c.state === "maintenance").length,
    down: report.components.filter((c) => c.state === "down" || c.state === "degraded").length,
  };

  return (
    <PageTemplate
      width="readable"
      header={
        <div className="flex flex-col gap-6 py-4">
          {/* La marque plutôt qu'un titre de page : cette page se lit seule,
              souvent depuis un lien envoyé par un tiers. */}
          <Link href="/" className="w-fit">
            <Brand name={branding.name.toUpperCase()} tagline={t("metaTitle")} />
          </Link>
          <div>
            <h1 className="font-bold text-2xl text-fg">{t("title")}</h1>
            <p className="text-muted text-sm">{t("subtitle")}</p>
          </div>
        </div>
      }
      toolbar={
        report.reachable ? (
          <AlertBanner variant={STATE_TONE[report.state]} title={t(`state.${report.state}`)}>
            {t(`stateBody.${report.state}`)}
          </AlertBanner>
        ) : (
          /* L'API muette est elle-même une information : on l'affiche comme
             une panne, plutôt que de laisser une page d'erreur prendre sa
             place. */
          <AlertBanner variant="danger" title={t("apiUnreachable")}>
            {t("apiUnreachableBody")}
          </AlertBanner>
        )
      }
    >
      {report.reachable ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              icon={<CheckCircle2 />}
              tone="success"
              label={t("operational")}
              value={counts.operational}
              hint={t("componentsUnit")}
            />
            <StatTile
              icon={<Clock />}
              tone={counts.maintenance ? "warning" : "default"}
              label={t("maintenance")}
              value={counts.maintenance}
              hint={t("componentsUnit")}
            />
            <StatTile
              icon={<TriangleAlert />}
              tone={counts.down ? "danger" : "default"}
              label={t("unreachable")}
              value={counts.down}
              hint={t("componentsUnit")}
            />
          </div>

          <Card>
            <CardHeader title={t("components")} description={t("componentsHint")} />
            <CardBody className="divide-y divide-border px-0 py-0">
              {report.components.length === 0 ? (
                <p className="px-6 py-8 text-center text-muted text-sm">{t("noComponent")}</p>
              ) : (
                report.components.map((component) => (
                  <div
                    key={component.id}
                    className="flex items-center justify-between gap-4 px-6 py-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <StatusDot
                        tone={STATE_TONE[component.state]}
                        pulse={component.state === "maintenance"}
                        label={t(`state.${component.state}`)}
                      />
                      <div>
                        <p className="font-semibold text-fg">{component.name}</p>
                        <p className="text-muted text-xs">{component.location}</p>
                        <StatusUptime uptime={component.uptime} />
                      </div>
                    </div>
                    <Badge variant={STATE_TONE[component.state]}>
                      {t(`state.${component.state}`)}
                    </Badge>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          <div>
            <h2 className="mb-3 font-semibold text-fg text-lg">{t("incidents")}</h2>
            {report.openIncidents.length === 0 ? (
              <Card>
                <CardBody className="flex items-center gap-3 text-muted text-sm">
                  <CircleSlash className="size-4" />
                  {t("noIncident")}
                </CardBody>
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                {report.openIncidents.map((incident) => (
                  <StatusIncidentCard key={incident.id} incident={incident} />
                ))}
              </div>
            )}
          </div>

          {report.recentIncidents.length > 0 ? (
            <div>
              <h2 className="mb-3 font-semibold text-fg text-lg">{t("history")}</h2>
              <div className="flex flex-col gap-4">
                {report.recentIncidents.map((incident) => (
                  <StatusIncidentCard key={incident.id} incident={incident} />
                ))}
              </div>
            </div>
          ) : null}

          {/* L'horodatage de la lecture : la réponse est mise en cache dix
              secondes, et une page de statut doit dire de quand elle date. */}
          <p className="text-center text-faint text-xs">
            {t("lastChecked")} <RelativeTime value={report.at} />
          </p>
        </>
      ) : null}
    </PageTemplate>
  );
}
