import type { InstatusSummary } from "@gamedashboard/contracts";
import { AlertBanner } from "@gamedashboard/ui";
import { getTranslations } from "next-intl/server";

/**
 * Ce que la page Instatus annonce, en haut du panel.
 *
 * Elle relaie une **décision** — des travaux prévus, un incident déclaré — et
 * non une observation. Le panel sait déjà dire qu'une machine ne répond plus ;
 * ce qu'il ne sait pas, c'est qu'une migration est prévue samedi. Les deux
 * cohabitent sans se corriger : une bannière de maintenance ne rend pas un node
 * muet joignable, et un node joignable ne dément pas une maintenance annoncée.
 *
 * Rien ne s'affiche quand l'état est `operational` ou `unknown`. Une bannière
 * permanente disant « tout va bien » devient un décor qu'on cesse de lire, et
 * la vraie bannière avec elle.
 */
export async function InstatusBanner({ notice }: { notice: InstatusSummary }) {
  if (notice.state !== "maintenance" && notice.state !== "incident") return null;

  const t = await getTranslations("instatus");
  const entries = notice.state === "maintenance" ? notice.maintenances : notice.incidents;

  return (
    <AlertBanner
      variant={notice.state === "incident" ? "danger" : "warning"}
      title={notice.state === "incident" ? t("incidentTitle") : t("maintenanceTitle")}
    >
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.id}>
              {entry.url ? (
                // La page publique porte le détail — durée, portée, avancement.
                // Le recopier ici obligerait à le maintenir à deux endroits.
                <a href={entry.url} target="_blank" rel="noreferrer">
                  {entry.name}
                </a>
              ) : (
                entry.name
              )}
            </li>
          ))}
        </ul>
      ) : (
        /* L'état est connu mais rien n'est détaillé : on le dit quand même,
           plutôt que de taire une information que la page publique porte. */
        <p>{t("seePage")}</p>
      )}

      {notice.pageUrl ? (
        <p className="mt-2 text-xs">
          <a href={notice.pageUrl} target="_blank" rel="noreferrer">
            {t("openPage", { name: notice.pageName ?? "Instatus" })}
          </a>
        </p>
      ) : null}
    </AlertBanner>
  );
}
