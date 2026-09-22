"use client";

import { AlertBanner, Button } from "@gamedashboard/ui";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptInvitation, declineInvitation, type PendingInvitation } from "@/server/api/subusers";

/**
 * Invitations reçues, à accepter ou refuser.
 *
 * **L'invitation ne donne aucun accès tant qu'on ne l'a pas acceptée**, et
 * c'est le but : sans cette étape, n'importe qui pourrait faire apparaître un
 * serveur inconnu dans la liste d'un tiers — et l'y engager.
 *
 * L'écran nomme celui qui invite. Accepter un accès demandé par une adresse
 * qu'on ne reconnaît pas n'est pas la même décision qu'accepter celle d'un
 * collègue.
 */
export function PendingInvitations({ invitations }: { invitations: PendingInvitation[] }) {
  const t = useTranslations("invitations");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (serverId: string, accept: boolean) =>
    startTransition(async () => {
      const result = accept ? await acceptInvitation(serverId) : await declineInvitation(serverId);
      setError(result.error);
      if (!result.error) router.refresh();
    });

  if (invitations.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {invitations.map((invitation) => (
        <AlertBanner
          key={invitation.serverId}
          variant="info"
          title={t("title", { server: invitation.serverName })}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {/* Le nombre de droits plutôt que leur liste : douze intitulés
                  dans un bandeau ne se lisent pas, et le détail se voit une
                  fois entré. */}
              {invitation.invitedBy
                ? t("from", { who: invitation.invitedBy, count: invitation.permissions.length })
                : t("fromUnknown", { count: invitation.permissions.length })}
            </span>

            <span className="flex gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => decide(invitation.serverId, true)}
              >
                <Check /> {t("accept")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => decide(invitation.serverId, false)}
              >
                <X /> {t("decline")}
              </Button>
            </span>
          </div>
        </AlertBanner>
      ))}
    </div>
  );
}
