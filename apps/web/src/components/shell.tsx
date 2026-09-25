"use client";

import { isExternalHref } from "@gamedashboard/contracts";
import {
  AppHeader,
  AppShell,
  Brand,
  type CommandAction,
  CommandPalette,
  CommandPaletteTrigger,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  HeaderIconButton,
  HeaderUser,
  HeaderUserIdentity,
  type NavSection,
  NotificationCenter,
  SidebarNav,
  SidebarServerSwitcher,
  ThemeToggle,
} from "@gamedashboard/ui";
import {
  Check,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Plug,
  Server,
  Settings as SettingsIcon,
  Shield,
  Terminal,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { AnnouncementBanners } from "@/components/announcement-banners";
import { useBranding } from "@/components/branding-provider";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { clearCommandHistories } from "@/lib/command-history";
import type { Announcement } from "@/server/api/announcements";
import type { Notification } from "@/server/api/notifications";
import { markNotificationsRead } from "@/server/api/notifications-actions";
import { setAccountLocale } from "@/server/api/preferences";
import { signOut } from "@/server/api/session";

/**
 * Les langues proposées, nommées **dans leur propre langue**.
 *
 * « English » et non « Anglais » : qui cherche à changer de langue ne lit pas
 * encore celle qui est affichée, et un menu traduit dans la langue qu'on veut
 * quitter est un menu qu'on ne sait pas lire.
 */
const LOCALE_CHOICES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
] as const;

/**
 * Nomme le chemin d'entrée, sans jamais inventer.
 *
 * Un fournisseur qu'on ne connaît pas est rendu tel quel plutôt que traduit en
 * « externe » : le jour où un nouveau fournisseur arrive, mieux vaut lire son
 * nom qu'un mot vague.
 */
function authMethodLabel(t: (key: string) => string, method: string): string {
  const known: Record<string, string> = {
    password: "methodPassword",
    passkey: "methodPasskey",
    sso: "methodSso",
    google: "methodGoogle",
    discord: "methodDiscord",
    github: "methodGithub",
  };
  const key = known[method];
  return key ? t(key) : method;
}

const STATE_TONE: Record<string, "success" | "danger" | "warning" | "info" | "neutral"> = {
  running: "success",
  offline: "danger",
  starting: "warning",
  stopping: "warning",
  installing: "info",
  suspended: "neutral",
  crash_loop: "danger",
  restoring: "info",
  transferring: "info",
};

/** Ce dont la coquille a besoin pour son sélecteur et sa palette de commandes. */
export interface ShellServer {
  id: string;
  name: string;
  shortId: string;
  address: string;
  game: string;
  nodeName: string;
  state: string;
}

export function PanelShell({
  sections,
  serverId,
  servers = [],
  notifications = [],
  userName,
  userEmail,
  userAvatarUrl,
  userRole,
  userAuthMethod,
  isAdmin = false,
  impersonatedBy = null,
  announcements = [],
  children,
}: {
  sections: NavSection[];
  serverId?: string;
  /**
   * Fourni par le layout, qui l'obtient de l'API. Une liste vide est un cas
   * normal — un nouveau client n'a aucun serveur — et non une erreur.
   */
  servers?: ShellServer[];
  /** Idem : une cloche vide est le cas ordinaire, pas un échec de chargement. */
  notifications?: Notification[];
  /** Nom affiché dans l'en-tête, issu de la session. */
  userName: string;
  /**
   * Adresse du compte connecté, affichée dans le menu.
   *
   * Le nom seul ne distingue pas deux comptes d'une même personne — client et
   * administration, par exemple — et c'est précisément ce qu'on vient vérifier
   * en ouvrant ce menu.
   */
  userEmail: string;
  userAvatarUrl?: string | null;
  /** Rôle du compte, tel que l'API le donne : `admin`, `reseller`, `user`… */
  userRole: string;
  /**
   * Par quel chemin cette session a été ouverte.
   *
   * Affiché parce que cela change ce qui est possible : quelqu'un entré par un
   * compte externe n'a pas forcément de mot de passe à changer, et le chercher
   * dans ses réglages de sécurité ne mènerait à rien.
   */
  userAuthMethod: string;
  /**
   * Décide des entrées d'administration de la palette.
   *
   * Elles mèneraient sinon à un 404 pour un compte ordinaire : la palette
   * proposerait des destinations que la mise en page refuse.
   */
  isAdmin?: boolean;
  /**
   * Adresse du membre du personnel qui regarde ce compte, ou nul.
   *
   * Sa seule présence fait apparaître le bandeau : le reste de la coquille
   * n'en sait rien et n'a pas à en savoir plus.
   */
  impersonatedBy?: string | null;
  /** Annonces en cours pour ce compte. Une liste vide est le cas ordinaire. */
  announcements?: Announcement[];
  children: ReactNode;
}) {
  const t = useTranslations("shell");
  // La marque servie pour ce domaine : l'en-tête d'un revendeur porte son nom.
  const branding = useBranding();
  const tn = useTranslations("nav");
  const tr = useTranslations("role");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  /**
   * Les notifications viennent du serveur et sont recopiées dans un état local
   * le temps que le rafraîchissement revienne : marquer comme lu doit éteindre
   * le compteur tout de suite, sinon le clic paraît sans effet.
   */
  const [seen, setSeen] = useState(false);
  const shown = useMemo(
    () =>
      notifications.map((n) => ({
        ...n,
        // `null` côté API, `undefined` côté composant : « aucun serveur
        // concerné » se dit explicitement en base, et la conversion se fait
        // ici, à la frontière, plutôt que dans les deux modèles.
        source: n.source ?? undefined,
        readAt: seen ? (n.readAt ?? new Date().toISOString()) : n.readAt,
      })),
    [notifications, seen],
  );

  const serverOptions = useMemo(
    () =>
      servers.map((s) => ({
        id: s.id,
        name: s.name,
        shortId: s.shortId,
        tone: STATE_TONE[s.state] ?? "neutral",
        href: `/server/${s.id}`,
      })),
    [servers],
  );

  const currentServer = serverId ? (serverOptions.find((s) => s.id === serverId) ?? null) : null;

  const actions = useMemo<CommandAction[]>(
    () => [
      {
        id: "nav-dashboard",
        // `quickAccess` et non `dashboard` : les deux pages ont été fusionnées,
        // et la clé a disparu avec celle qui ne servait plus. La palette
        // continuait de la demander, et n'affichait plus rien à cette ligne.
        label: tn("quickAccess"),
        group: t("navigation"),
        icon: <LayoutDashboard />,
        keywords: "accueil kpi",
        onSelect: () => router.push("/"),
      },
      {
        id: "nav-servers",
        label: t("myServers"),
        group: t("navigation"),
        icon: <Server />,
        onSelect: () => router.push("/servers"),
      },
      {
        id: "nav-account",
        label: tn("profile"),
        group: t("navigation"),
        icon: <User />,
        onSelect: () => router.push("/account"),
      },
      {
        id: "nav-security",
        label: tn("security"),
        group: t("navigation"),
        icon: <Shield />,
        keywords: "2fa passkey mot de passe sessions",
        onSelect: () => router.push("/account/security"),
      },
      ...(isAdmin
        ? [
            {
              id: "nav-api",
              label: t("apiDocs"),
              group: t("navigation"),
              icon: <Plug />,
              keywords: "api clé oauth sso routes développeur",
              onSelect: () => router.push("/admin/api"),
            },
            {
              id: "nav-admin",
              label: tn("admin"),
              group: t("navigation"),
              icon: <Shield />,
              keywords: "admin nodes eggs",
              onSelect: () => router.push("/admin"),
            },
          ]
        : []),
      ...servers.map((s) => ({
        id: `server-${s.id}`,
        label: s.name,
        hint: s.address,
        group: tn("servers"),
        icon: <Terminal />,
        keywords: `${s.game} ${s.nodeName} console`,
        onSelect: () => router.push(`/server/${s.id}`),
      })),
    ],
    [router, servers, t, tn, isAdmin],
  );

  return (
    <>
      {/* Au-dessus de tout, et sans croix : un agent qui oublie où il est lit
          les fichiers d'un client en croyant lire les siens. */}
      {impersonatedBy ? <ImpersonationBanner account={userEmail} /> : null}

      <CommandPalette actions={actions} />
      <AppShell
        header={
          <AppHeader
            brand={
              <Link href="/">
                <Brand name={branding.name.toUpperCase()} />
              </Link>
            }
            center={
              <CommandPaletteTrigger
                onClick={() =>
                  window.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
                  )
                }
              />
            }
            actions={
              <>
                <ThemeToggle />
                {/*
                  L'assistance n'apparaît que si elle mène quelque part.

                  Le lien vient de la marque servie : un client d'un revendeur
                  doit joindre **son** revendeur, pas la plateforme, qui ne le
                  connaît pas. Sans adresse déclarée, le bouton est retiré —
                  un bouton qui ne fait rien se clique deux fois avant qu'on
                  renonce.
                */}
                {branding.supportUrl ? (
                  <HeaderIconButton
                    icon={<LifeBuoy />}
                    label={t("support")}
                    onClick={() => window.open(branding.supportUrl ?? "", "_blank", "noopener")}
                  />
                ) : null}
                <NotificationCenter
                  notifications={shown}
                  onMarkAllRead={() => {
                    setSeen(true);
                    void markNotificationsRead();
                  }}
                  /*
                   * Une cloche conduit, elle n'annonce pas seulement.
                   *
                   * L'adresse vient de l'API, qui la déduit du type de
                   * l'événement — la console du serveur concerné, la liste des
                   * sauvegardes, l'espace client du facturier. Une échéance
                   * mène donc là où l'on paie, et non à une page du panel qui
                   * ne sait rien encaisser.
                   */
                  onSelect={(item) => {
                    if (!item.href) return;
                    // Une adresse hors du panel s'ouvre à côté : on ne fait pas
                    // quitter sa console à quelqu'un pour lui montrer une facture.
                    if (isExternalHref(item.href)) {
                      window.open(item.href, "_blank", "noopener,noreferrer");
                      return;
                    }
                    router.push(item.href);
                  }}
                />
                {/*
                 * Le chevron annonçait un menu qui n'existait pas.
                 *
                 * Trois entrées, et pas une de plus : modifier ses
                 * informations, sa sécurité, et partir. Le reste appartient à
                 * la navigation — un menu de compte qui duplique le menu
                 * principal oblige à chercher aux deux endroits.
                 */}
                <Dropdown>
                  <DropdownTrigger asChild>
                    <HeaderUser name={userName} avatarUrl={userAvatarUrl} />
                  </DropdownTrigger>
                  <DropdownContent className="min-w-64">
                    <HeaderUserIdentity
                      name={userName}
                      email={userEmail}
                      avatarUrl={userAvatarUrl}
                      role={tr(userRole)}
                      method={t("signedInWith", { method: authMethodLabel(t, userAuthMethod) })}
                    />
                    <DropdownSeparator />
                    <DropdownItem icon={<User />} onSelect={() => router.push("/account")}>
                      {t("editDetails")}
                    </DropdownItem>
                    <DropdownItem
                      icon={<SettingsIcon />}
                      onSelect={() => router.push("/account/security")}
                    >
                      {t("accountSettings")}
                    </DropdownItem>
                    <DropdownSeparator />
                    {/*
                     * La langue se force ici, et l'écran entier suit.
                     *
                     * Elle était jusqu'ici déduite du navigateur, sans moyen de
                     * la contredire : quelqu'un dont le système est en anglais
                     * ne pouvait pas lire le panel en français, et n'avait
                     * nulle part où le dire. Le choix est enregistré sur le
                     * compte, pas seulement dans ce navigateur, pour qu'il
                     * suive d'un appareil à l'autre.
                     */}
                    <DropdownLabel>{t("language")}</DropdownLabel>
                    {LOCALE_CHOICES.map((choice) => (
                      <DropdownItem
                        key={choice.value}
                        icon={locale === choice.value ? <Check /> : <span className="size-4" />}
                        onSelect={() => void setAccountLocale(choice.value)}
                      >
                        {choice.label}
                      </DropdownItem>
                    ))}
                    <DropdownSeparator />
                    {/* Une action serveur, pas un lien : la session doit être
                        révoquée en base, pas seulement oubliée par l'onglet. */}
                    <DropdownItem
                      icon={<LogOut />}
                      destructive
                      onSelect={() => {
                        // Les commandes tapées restent sur l'appareil tant que
                        // la session dure, pas au-delà (`command-history.ts`).
                        try {
                          clearCommandHistories(window.localStorage);
                        } catch {
                          // Stockage refusé : il n'y a rien à effacer.
                        }
                        void signOut();
                      }}
                    >
                      {t("signOut")}
                    </DropdownItem>
                  </DropdownContent>
                </Dropdown>
              </>
            }
          />
        }
        sidebar={
          <SidebarNav
            sections={sections}
            currentPath={pathname}
            LinkComponent={Link}
            bottom={
              // Hors contexte serveur, il n'y a rien à sélectionner : pas de bloc.
              currentServer ? (
                <SidebarServerSwitcher
                  current={currentServer}
                  servers={serverOptions}
                  LinkComponent={Link}
                />
              ) : undefined
            }
          />
        }
      >
        {/* Au-dessus du contenu, sous l'en-tête : une annonce de plateforme
            concerne la page qu'on regarde, quelle qu'elle soit. */}
        <AnnouncementBanners announcements={announcements} />
        {children}
      </AppShell>
    </>
  );
}
