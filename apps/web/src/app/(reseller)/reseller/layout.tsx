import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PanelShell } from "@/components/shell";
import { resellerNav } from "@/config/navigation";
import { displayName } from "@/lib/session-user";
import { fetchActiveAnnouncements } from "@/server/api/announcements";
import { fetchMe } from "@/server/api/client";
import { fetchNotifications } from "@/server/api/notifications";

export default async function ResellerLayout({ children }: { children: ReactNode }) {
  const [t, notifications, me, announcements] = await Promise.all([
    getTranslations("nav"),
    fetchNotifications(),
    fetchMe(),
    fetchActiveAnnouncements(),
  ]);

  /**
   * Contrôle de rôle à l'entrée de l'espace.
   *
   * Un 404 et non une redirection, pour la même raison que l'administration :
   * répondre « interdit » confirmerait l'existence de l'espace à qui n'y a pas
   * accès. Ce contrôle ne remplace pas celui de l'API, qui reste la règle
   * opposable — il cesse simplement d'afficher ce qui n'est pas dû.
   *
   * Un administrateur n'entre pas non plus : il dispose de `/admin`, qui voit
   * déjà tout le parc.
   */
  if (me.role !== "reseller") notFound();

  return (
    <PanelShell
      sections={resellerNav(t)}
      notifications={notifications}
      userName={displayName(me)}
      userEmail={me.email}
      userRole={me.role}
      userAuthMethod={me.authMethod}
      impersonatedBy={me.impersonator?.email ?? null}
      announcements={announcements}
      userAvatarUrl={me.avatarUrl}
    >
      {children}
    </PanelShell>
  );
}
