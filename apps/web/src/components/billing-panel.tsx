import type { HostbillSummary } from "@gamedashboard/contracts";
import { HOSTBILL_DUE_SOON_DAYS } from "@gamedashboard/contracts";
import { AlertBanner, Badge, Card, CardBody, CardHeader } from "@gamedashboard/ui";
import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Le bloc de facturation de la page d'accueil.
 *
 * Il ne s'affiche que si HostBill est configuré. Un encart « facturation non
 * configurée » n'apprend rien au client — c'est à l'exploitant qu'il
 * s'adresse, et l'exploitant a l'écran des réglages pour cela.
 */
export async function BillingPanel({ billing }: { billing: HostbillSummary }) {
  if (!billing.configured) return null;

  const t = await getTranslations("quickAccess");

  if (billing.unreachable) {
    /*
     * « Nous n'avons pas pu demander », et non « vous n'avez rien ».
     *
     * Afficher une liste vide parce que la facturation ne répond pas ferait
     * croire à un client que ses services ont disparu. La distinction se paie
     * en un état de plus ; ne pas la faire se paie en appels au support.
     */
    return (
      <AlertBanner variant="warning" title={t("billingUnreachableTitle")}>
        {t("billingUnreachableBody")}
      </AlertBanner>
    );
  }

  if (billing.services.length === 0) return null;

  const due = billing.services
    .filter((service) => service.daysLeft !== null && service.daysLeft <= HOSTBILL_DUE_SOON_DAYS)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  return (
    <Card>
      <CardHeader
        title={t("billingTitle")}
        description={t("billingSubtitle")}
        actions={
          billing.clientUrl ? (
            <a
              href={billing.clientUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm"
            >
              {t("openClientArea")} <ExternalLink className="size-4" />
            </a>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-4">
        {due.length > 0 ? (
          <AlertBanner
            // Une échéance dépassée n'est pas un rappel, c'est un retard.
            variant={due.some((service) => (service.daysLeft ?? 0) < 0) ? "danger" : "warning"}
            title={t("dueSoonTitle", { count: due.length })}
          >
            {t("dueSoonBody")}
          </AlertBanner>
        ) : null}

        <div className="flex flex-col divide-y divide-border">
          {billing.services.map((service) => (
            <div
              key={service.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="font-semibold text-fg text-sm">{service.name}</p>
                <p className="truncate text-muted text-xs">
                  {service.plan ?? t("noPlan")}
                  {service.amount ? ` · ${service.amount} ${service.currency ?? ""}`.trimEnd() : ""}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Badge variant={service.state === "active" ? "success" : "warning"}>
                  {t(`state.${service.state}`)}
                </Badge>
                <span className="text-right text-xs">
                  {/*
                   * Le compte à rebours, et la date sous elle.
                   *
                   * « Dans 12 jours » se lit d'un coup d'œil ; la date répond à
                   * la question suivante, qui est « lequel des deux vendredis ».
                   */}
                  {service.daysLeft === null ? (
                    <span className="text-faint">{t("noDueDate")}</span>
                  ) : (
                    <>
                      <span
                        className={
                          service.daysLeft < 0
                            ? "font-semibold text-danger-ink"
                            : service.daysLeft <= HOSTBILL_DUE_SOON_DAYS
                              ? "font-semibold text-warning-ink"
                              : "text-fg"
                        }
                      >
                        {service.daysLeft < 0
                          ? t("overdue", { days: Math.abs(service.daysLeft) })
                          : t("daysLeft", { days: service.daysLeft })}
                      </span>
                      <span className="block text-faint">{service.dueDate}</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
