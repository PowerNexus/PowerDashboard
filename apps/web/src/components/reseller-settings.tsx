"use client";

import type { PlatformAccess } from "@gamedashboard/contracts";
import { PLATFORM_ACCESS_LEVELS, PLATFORM_ACCESS_META } from "@gamedashboard/contracts";
import { AlertBanner, PageHeader, PageTemplate, SettingsSection } from "@gamedashboard/ui";
import { Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setPlatformAccess } from "@/server/api/reseller";

/**
 * Réglages du revendeur.
 *
 * Un seul choix, mais celui qui décide de tout : ce que l'administration de la
 * plateforme peut faire sur son parc.
 *
 * **Il avait deux positions et n'en tenait qu'une.** « Autoriser la création »
 * ne bloquait que la création : un administrateur gardait la console, les
 * fichiers et la suppression de tous les serveurs du revendeur. Celui-ci
 * croyait fermer une porte ; il n'en fermait qu'une sur trois.
 *
 * Trois choix présentés ensemble plutôt qu'un interrupteur : il n'y a pas de
 * « oui / non » ici, mais un curseur entre ce qu'on délègue et ce qu'on
 * reprend. Chaque cran a un coût, et on doit pouvoir le comparer **avant** de
 * cliquer — pas le découvrir après.
 */
export function ResellerSettings({ level }: { level: PlatformAccess }) {
  const t = useTranslations("reseller");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * L'état affiché vient du serveur, jamais d'une mémoire locale.
   *
   * Déplacer la sélection à l'écran avant la réponse de l'API montrerait un
   * niveau qui, en cas de refus, reviendrait au rechargement suivant. Sur ce
   * réglage-là, croire avoir tout fermé alors qu'on n'a rien changé est
   * exactement ce qu'il ne faut pas.
   */
  const choisir = (next: PlatformAccess) =>
    startTransition(async () => {
      if (next === level) return;
      const result = await setPlatformAccess(next);
      setError(result.error);
      if (!result.error) router.refresh();
    });

  return (
    <PageTemplate
      header={
        <PageHeader icon={<Settings />} title={t("settingsTitle")} subtitle={t("settingsHint")} />
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      <SettingsSection title={t("provisioning")} description={t("provisioningHint")}>
        <fieldset className="flex flex-col gap-3" disabled={pending}>
          <legend className="sr-only">{t("provisioning")}</legend>

          {PLATFORM_ACCESS_LEVELS.map((niveau) => {
            const meta = PLATFORM_ACCESS_META[niveau];
            const choisi = niveau === level;

            return (
              <label
                key={niveau}
                className={[
                  "flex cursor-pointer gap-3 rounded-field border p-4 transition-colors",
                  choisi
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-surface hover:bg-surface-2",
                  pending ? "cursor-not-allowed opacity-60" : "",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="platform-access"
                  value={niveau}
                  checked={choisi}
                  onChange={() => choisir(niveau)}
                  className="mt-1 size-4 shrink-0 accent-accent"
                />
                <span className="flex flex-col gap-1">
                  <span className="font-semibold text-fg text-sm">{meta.label}</span>
                  <span className="text-muted text-xs">{meta.body}</span>
                  {/*
                    Le coût de ce cran, sur chaque carte et pas seulement sur
                    celle retenue : c'est ce qu'on veut comparer, et l'afficher
                    après coup ne sert plus à décider.

                    La plateforme dépanne deux choses différentes — la machine,
                    et le logiciel qui tourne dessus. La première ne demande
                    aucun accès au serveur, la seconde en demande un. Fermer
                    n'est donc pas qu'une décision de confidentialité : c'est
                    reprendre à sa charge le dépannage applicatif de ses
                    clients.
                  */}
                  <span className="text-faint text-xs italic">{meta.support}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </SettingsSection>
    </PageTemplate>
  );
}
