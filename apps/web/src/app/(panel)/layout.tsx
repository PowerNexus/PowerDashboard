import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { EmailVerificationNotice } from "@/components/email-verification-notice";
import { PanelShell } from "@/components/shell";
import { accountNav } from "@/config/navigation";
import { ADMIN_ROLES } from "@/lib/roles";
import { toShellServer } from "@/lib/server-view";
import { displayName } from "@/lib/session-user";
import { fetchActiveAnnouncements } from "@/server/api/announcements";
import { fetchMe, fetchMyServers } from "@/server/api/client";
import { fetchNotifications } from "@/server/api/notifications";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  // Les quatre lectures partent ensemble : elles ne dépendent pas les unes des
  // autres, et les enchaîner ajouterait leurs latences bout à bout sur chaque
  // page du panel.
  const [t, servers, notifications, me, announcements] = await Promise.all([
    getTranslations("nav"),
    fetchMyServers(),
    fetchNotifications(),
    fetchMe(),
    fetchActiveAnnouncements(),
  ]);

  const access = { isAdmin: ADMIN_ROLES.has(me.role), isReseller: me.role === "reseller" };

  return (
    <PanelShell
      sections={accountNav(t, access)}
      isAdmin={access.isAdmin}
      servers={servers.map(toShellServer)}
      notifications={notifications}
      userName={displayName(me)}
      userEmail={me.email}
      userRole={me.role}
      userAuthMethod={me.authMethod}
      impersonatedBy={me.impersonator?.email ?? null}
      announcements={announcements}
      userAvatarUrl={me.avatarUrl}
    >
      {/*
       * Le bandeau vit dans la mise en page du client, et non dans la coquille
       * partagée : c'est le compte du client qui a besoin d'une adresse
       * joignable — pour une réinitialisation de mot de passe, pour un rappel
       * d'échéance. Un administrateur en poste n'a pas à le voir partout.
       */}
      {me.emailVerifiedAt === null ? (
        <div className="mx-auto mb-6 w-full max-w-[1400px]">
          <EmailVerificationNotice email={me.email} />
        </div>
      ) : null}
      {children}
    </PanelShell>
  );
}
