"use client";

import {
  Avatar,
  FormField,
  Input,
  PageHeader,
  PageTemplate,
  SelectMenu,
  SettingsSection,
  SettingToggle,
  ThemeToggle,
} from "@gamedashboard/ui";
import { Mail, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { NotificationPreferences } from "@/components/notification-preferences";
import { displayName, type SessionUser } from "@/lib/session-user";
import type { NotificationPreferences as NotificationPreferencesData } from "@/server/api/notification-preferences";
import { setAccountLocale, setAccountTimezone } from "@/server/api/preferences";

/** Étiquettes des rôles. Un rôle inconnu s'affiche brut plutôt que disparaître. */
/** Rôles connus. Un rôle inconnu s'affiche brut plutôt que disparaître. */
const KNOWN_ROLES = new Set(["admin", "support", "reseller", "user"]);

/**
 * Fuseaux proposés.
 *
 * Une liste courte, et non les six cents identifiants de la base IANA : un
 * menu de six cents lignes ne se parcourt pas. L'API, elle, accepte tout
 * identifiant valide — quelqu'un qui en a besoin d'un autre n'est pas bloqué
 * par cet écran, et la liste peut s'allonger sans rien changer ailleurs.
 */
const TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Moscow",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function AccountWorkspace({
  user,
  notifications,
}: {
  user: SessionUser;
  notifications: NotificationPreferencesData;
}) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const tr = useTranslations("role");
  const name = displayName(user);
  const router = useRouter();

  const [compact, setCompact] = useState(false);
  const [locale, setLocale] = useState(user.locale);
  const [timezone, setTimezone] = useState(user.timezone);
  const [pending, startTransition] = useTransition();

  // L'écran se refabrique après l'enregistrement : la coquille entière est
  // traduite, et la langue doit changer sous les yeux de qui vient de la
  // choisir.
  const save = (action: () => Promise<{ error: string | null }>) =>
    startTransition(async () => {
      await action();
      router.refresh();
    });

  return (
    <PageTemplate
      header={<PageHeader icon={<User />} title={t("title")} subtitle={t("subtitle")} />}
    >
      {/* Lecture seule : modifier son identité passe par le compte GameDashboard,
          source de vérité pour le SSO (§5.1). Un formulaire modifiable ici
          enregistrerait des valeurs que la prochaine connexion écraserait. */}
      <SettingsSection title={t("identity")} description={t("identityHint")}>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={name} size="lg" />
            <div>
              <p className="text-sm font-semibold text-fg">{name}</p>
              {/* Le rôle plutôt qu une date d inscription : il décide de ce que
                  la personne voit dans le panel, la date ne décide de rien. */}
              <p className="text-xs text-muted">
                {KNOWN_ROLES.has(user.role) ? tr(user.role) : user.role}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <FormField label={t("firstName")}>
              {(id) => <Input id={id} defaultValue={user.nameFirst} readOnly />}
            </FormField>
            <FormField label={t("lastName")}>
              {(id) => <Input id={id} defaultValue={user.nameLast} readOnly />}
            </FormField>
          </div>
          <FormField label={tc("email")} description={t("emailHint")}>
            {(id) => (
              <Input
                id={id}
                type="email"
                defaultValue={user.email}
                readOnly
                leadingIcon={<Mail />}
              />
            )}
          </FormField>
        </div>
      </SettingsSection>

      <SettingsSection title={t("display")} description={t("displayHint")}>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-6">
            <div>
              <p className="text-sm font-semibold text-fg">{t("theme")}</p>
              <p className="text-xs text-muted">{t("themeHint")}</p>
            </div>
            <ThemeToggle />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {/*
             * Enregistré sur le compte, et non dans ce navigateur seul.
             *
             * Ces deux champs ne faisaient rien : ils affichaient un choix que
             * personne n'écrivait, ce qui est pire qu'un champ absent — on
             * croit avoir réglé sa langue, et la page revient à l'anglais au
             * rechargement suivant. La langue suit désormais la personne, d'un
             * appareil à l'autre.
             */}
            <FormField label={t("language")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={locale}
                  disabled={pending}
                  onValueChange={(next) => {
                    setLocale(next);
                    save(() => setAccountLocale(next));
                  }}
                  options={[
                    { value: "fr", label: "Français" },
                    { value: "en", label: "English" },
                  ]}
                />
              )}
            </FormField>
            <FormField label={t("timezone")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={timezone}
                  disabled={pending}
                  onValueChange={(next) => {
                    setTimezone(next);
                    save(() => setAccountTimezone(next));
                  }}
                  options={TIMEZONES.map((zone) => ({ value: zone, label: zone }))}
                />
              )}
            </FormField>
          </div>
          <div className="border-t border-border">
            <SettingToggle
              label={t("compact")}
              description={t("compactHint")}
              checked={compact}
              onCheckedChange={setCompact}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("notifications")} description={t("notificationsHint")}>
        {/* Les deux interrupteurs qui étaient ici — « E-mail » et « Discord » —
            ne commandaient rien : ils vivaient dans l'état local du composant,
            se remettaient à leur valeur de départ au rechargement, et aucune
            ligne de code ne les lisait. Discord n'est pas revenu : il
            reviendra le jour où quelque chose émettra vers Discord. */}
        <NotificationPreferences initial={notifications} />
      </SettingsSection>
    </PageTemplate>
  );
}
