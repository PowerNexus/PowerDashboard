import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PanelShell } from "@/components/shell";
import { StaffTwoFactorNotice } from "@/components/staff-2fa-notice";
import { adminNav } from "@/config/navigation";
import { ADMIN_ROLES } from "@/lib/roles";
import { displayName } from "@/lib/session-user";
import { fetchActiveAnnouncements } from "@/server/api/announcements";
import { fetchMe } from "@/server/api/client";
import { fetchNotifications } from "@/server/api/notifications";
import { fetchTwoFactorStatus } from "@/server/api/two-factor";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [t, notifications, me, announcements] = await Promise.all([
    getTranslations("nav"),
    fetchNotifications(),
    fetchMe(),
    fetchActiveAnnouncements(),
  ]);

  /**
   * Contrôle de rôle, à l'entrée de tout l'espace.
   *
   * Jusqu'ici, les écrans d'administration n'étaient protégés que **par
   * accident** : leurs chargements de données passent par des routes gardées,
   * qui échouaient pour un compte ordinaire. La page de référence de l'API ne
   * charge rien du tout — elle serait restée entièrement lisible.
   *
   * Un 404 et non une redirection, pour la même raison que la garde de l'API :
   * répondre « interdit » confirmerait l'existence de l'espace à qui n'y a pas
   * accès. Ce contrôle ne remplace pas ceux de l'API, qui restent la règle
   * opposable : celui-ci ne fait que cesser d'afficher ce qui n'est pas dû.
   */
  if (!ADMIN_ROLES.has(me.role)) notFound();

  /*
   * Seconde preuve exigée du personnel, quand la plateforme le demande.
   *
   * L'API refuse déjà ces routes — c'est elle qui fait règle — mais son refus
   * arriverait ici sous la forme d'une page en erreur, sans dire quoi faire.
   * Ce contrôle ne remplace rien : il transforme un refus en explication, et
   * mène là où on peut le lever.
   *
   * La question est posée à l'API du compte, accessible à tous : demander le
   * réglage de la plateforme supposerait un accès à l'administration, que ce
   * compte n'a justement pas encore.
   */
  const twoFactor = await fetchTwoFactorStatus();
  if (twoFactor.required && !twoFactor.enabled) {
    return (
      <PanelShell
        sections={adminNav(t)}
        notifications={notifications}
        userName={displayName(me)}
        userEmail={me.email}
        userRole={me.role}
        userAuthMethod={me.authMethod}
        impersonatedBy={me.impersonator?.email ?? null}
        announcements={announcements}
        userAvatarUrl={me.avatarUrl}
      >
        <StaffTwoFactorNotice />
      </PanelShell>
    );
  }

  // Pas de sélecteur de serveur dans l'espace d'administration : il n'y a pas
  // de « serveur courant » à cet endroit.
  return (
    <PanelShell
      sections={adminNav(t)}
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
