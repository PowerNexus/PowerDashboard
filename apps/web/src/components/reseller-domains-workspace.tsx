"use client";

import { certificateStanding } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  type ColumnDef,
  DataTable,
  EmptyState,
  PageHeader,
  PageTemplate,
  RelativeTime,
} from "@gamedashboard/ui";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ResellerDomain } from "@/server/api/reseller-domains";

/**
 * Domaines propres déclarés par les revendeurs, et l'état de leur certificat.
 *
 * Écran de **lecture seule**, et c'est voulu : l'administration ne déclare pas
 * le domaine d'un revendeur à sa place — il faut en posséder la zone pour
 * publier la preuve, et un domaine posé ici sans preuve servirait la marque de
 * quelqu'un sur un nom qui ne lui appartient pas.
 *
 * Il ne délivre pas non plus les certificats : c'est un agent, sur le serveur
 * web, qui appelle certbot. Cet écran montre ce qu'il a rapporté. La question
 * à laquelle il répond est toujours la même — **les clients de ce revendeur
 * voient-ils un avertissement de sécurité, et si oui pourquoi**.
 */
export function ResellerDomainsWorkspace({ domains }: { domains: ResellerDomain[] }) {
  const t = useTranslations("resellerDomains");

  /*
   * L'agent a-t-il déjà donné signe de vie ?
   *
   * Aucune tentative sur aucun domaine vérifié, c'est presque toujours qu'il
   * n'est pas installé. Sans ce constat, l'écran afficherait « en attente »
   * pour toujours, et l'attente paraîtrait normale — c'est le genre de panne
   * qui se découvre par un client, des semaines plus tard.
   */
  const aVerifies = domains.some((d) => d.verifiedAt !== null);
  const agentMuet =
    aVerifies && domains.every((d) => d.verifiedAt === null || d.certificateAttemptedAt === null);

  const columns = useMemo<ColumnDef<ResellerDomain, unknown>[]>(
    () => [
      {
        accessorKey: "domain",
        header: t("columnDomain"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="gd-mono truncate font-semibold text-fg">{row.original.domain}</p>
            <p className="truncate text-muted text-xs">{row.original.email}</p>
          </div>
        ),
      },
      {
        accessorKey: "verifiedAt",
        header: t("columnState"),
        cell: ({ row }) =>
          row.original.verifiedAt ? (
            <div className="flex items-center gap-2">
              <Badge variant="success">{t("verified")}</Badge>
              <span className="text-muted text-xs">
                <RelativeTime value={row.original.verifiedAt} />
              </span>
            </div>
          ) : (
            // Déclaré sans preuve : le panel ne sert rien sur ce nom. Il figure
            // ici parce que c'est précisément l'état sur lequel un revendeur
            // appelle à l'aide.
            <Badge variant="warning">{t("pending")}</Badge>
          ),
      },
      {
        id: "certificate",
        header: t("columnCertificate"),
        cell: ({ row }) => {
          const etat = certificateStanding(row.original);

          if (etat === "not_sought") {
            // Rien n'est demandé tant que le domaine n'est pas vérifié : une
            // pastille ici laisserait croire à une panne alors qu'il n'y a rien
            // à faire.
            return <span className="text-faint text-xs">{t("certificateNotSought")}</span>;
          }

          return (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                {etat === "active" ? (
                  <Badge variant="success">{t("certificateActive")}</Badge>
                ) : etat === "renewing" ? (
                  // Le client ne voit encore rien, mais le renouvellement a
                  // échoué : c'est maintenant qu'il faut agir, pas au jour de
                  // l'expiration.
                  <Badge variant="warning">{t("certificateRenewing")}</Badge>
                ) : etat === "failed" ? (
                  <Badge variant="danger">{t("certificateFailed")}</Badge>
                ) : etat === "queued" ? (
                  <Badge variant="neutral">{t("certificateQueued")}</Badge>
                ) : (
                  <Badge variant="neutral">{t("certificateUnknown")}</Badge>
                )}

                {row.original.certificateExpiresAt ? (
                  <span className="text-muted text-xs">
                    {t("certificateUntil")}{" "}
                    <RelativeTime value={row.original.certificateExpiresAt} />
                  </span>
                ) : null}
              </div>

              {/*
                Le motif d'échec en toutes lettres, et non un code.

                L'agent le formule pour dire **à qui** est le problème : au
                revendeur qui n'a pas pointé sa zone, à la plateforme, ou à
                l'autorité qui limite le débit. Le tronquer obligerait à ouvrir
                un journal sur le serveur pour savoir quoi répondre.
              */}
              {row.original.certificateFailure ? (
                <p className="text-danger-ink text-xs">{row.original.certificateFailure}</p>
              ) : null}

              {row.original.certificateAttemptedAt ? (
                <p className="text-faint text-xs">
                  {t("certificateAttempted")}{" "}
                  <RelativeTime value={row.original.certificateAttemptedAt} />
                </p>
              ) : null}
            </div>
          );
        },
      },
    ],
    [t],
  );

  return (
    <PageTemplate
      header={<PageHeader icon={<Globe />} title={t("title")} subtitle={t("subtitle")} />}
    >
      {agentMuet ? (
        <AlertBanner variant="warning" title={t("agentSilentTitle")}>
          {t("agentSilentBody")}
        </AlertBanner>
      ) : (
        <AlertBanner variant="info" title={t("tlsTitle")}>
          {t("tlsBody")}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        data={domains}
        getRowId={(row) => row.userId}
        emptyState={
          <EmptyState icon={<Globe />} title={t("emptyTitle")} description={t("emptyBody")} />
        }
      />
    </PageTemplate>
  );
}
