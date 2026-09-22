"use client";

import { AlertBanner, Badge, SettingToggle } from "@gamedashboard/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  type NotificationPreference,
  type NotificationPreferences as Preferences,
  saveNotificationPreference,
} from "@/server/api/notification-preferences";

/**
 * Ce que le compte reçoit par courriel.
 *
 * **La cloche n'est pas réglable, et c'est volontaire.** Une notification qu'on
 * n'a nulle part n'existe pas : quelqu'un qui coupe tout doit encore pouvoir
 * retrouver ce qui s'est passé en ouvrant le panel. Le seul choix qui se pose
 * est donc « est-ce que cela mérite aussi un courriel ».
 *
 * La liste vient du serveur, jamais recopiée ici : un événement ajouté côté
 * panel apparaît tout seul, et une liste tenue dans le navigateur aurait fini
 * par proposer des interrupteurs qui ne commandent rien — ce que cet écran
 * faisait précisément avant.
 */
export function NotificationPreferences({ initial }: { initial: Preferences }) {
  const t = useTranslations("notificationPrefs");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (preference: NotificationPreference, wantsEmail: boolean) =>
    startTransition(async () => {
      const channels = wantsEmail ? ["inapp", "email"] : ["inapp"];
      const result = await saveNotificationPreference(preference.type, channels);
      setError(result.error);
      // L'état affiché vient du serveur : basculer l'interrupteur à l'écran
      // avant la réponse montrerait un choix qui, en cas de refus, se
      // reprendrait au rechargement suivant.
      if (!result.error) router.refresh();
    });

  const groups = new Map<string, NotificationPreference[]>();
  for (const item of initial.items) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {/*
        Deux raisons pour lesquelles un courriel ne partira pas, et elles se
        corrigent à deux endroits différents : le SMTP est l'affaire de la
        plateforme, l'adresse confirmée celle du compte. Les fondre en « le
        courriel est indisponible » ferait attendre une correction qui ne
        viendrait pas.
      */}
      {!initial.mailEnabled ? (
        <AlertBanner variant="warning" title={t("noSmtpTitle")}>
          {t("noSmtpBody")}
        </AlertBanner>
      ) : !initial.emailVerified ? (
        <AlertBanner variant="warning" title={t("unverifiedTitle")}>
          {t("unverifiedBody")}
        </AlertBanner>
      ) : null}

      {[...groups.entries()].map(([group, items]) => (
        <div key={group} className="flex flex-col gap-1">
          <p className="font-semibold text-muted text-xs uppercase tracking-wide">
            {t(`group.${group}`)}
          </p>
          <div className="divide-y divide-border">
            {items.map((item) => (
              <SettingToggle
                key={item.type}
                label={t(`event.${item.type}`)}
                // Seul l'obligatoire porte une explication : les autres se comprennent
                // à leur intitulé, et une phrase sous chaque ligne ferait une page
                // qu'on ne lit plus.
                description={item.mandatory ? t("mandatoryHint") : undefined}
                checked={item.channels.includes("email")}
                // Verrouillé plutôt que masqué : ce qui se décide contre le
                // client — une suspension, un serveur arrêté — se notifie quoi
                // qu'il arrive, et le cacher ferait croire qu'on ne prévient
                // pas.
                disabled={pending || item.mandatory}
                onCheckedChange={(next) => toggle(item, next)}
              />
            ))}
          </div>
        </div>
      ))}

      <p className="text-faint text-xs">
        <Badge variant="neutral">{t("bellAlways")}</Badge> {t("bellAlwaysHint")}
      </p>
    </div>
  );
}
