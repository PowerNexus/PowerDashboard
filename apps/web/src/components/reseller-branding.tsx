"use client";

import type { BrandingOverrides } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  CopyButton,
  FormField,
  Input,
  PageHeader,
  PageTemplate,
  RelativeTime,
  SettingsSection,
} from "@gamedashboard/ui";
import { Palette } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  type ResellerBranding as Branding,
  saveResellerBranding,
  setResellerDomain,
  verifyResellerDomain,
} from "@/server/api/reseller-branding";

/**
 * Marque blanche du revendeur, et domaine par lequel elle s'applique.
 *
 * Les deux sont sur le même écran parce qu'ils ne se comprennent pas l'un sans
 * l'autre : la personnalisation ne s'affiche **nulle part** tant qu'aucun
 * domaine propre n'est vérifié — c'est le domaine d'arrivée qui choisit la
 * marque servie, avant toute session. Les séparer en deux pages ferait remplir
 * un formulaire dont le résultat reste invisible.
 */
export function ResellerBranding({ initial }: { initial: Branding }) {
  const t = useTranslations("branding");
  const tc = useTranslations("common");
  const router = useRouter();

  const [form, setForm] = useState<BrandingOverrides>(initial.overrides);
  const [domain, setDomain] = useState(initial.domain.domain ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const state = initial.domain;
  const field = (key: keyof BrandingOverrides) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const run = (action: () => Promise<{ error: string | null }>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      // Rafraîchi même en cas d'échec : la vérification écrit son motif, et
      // c'est la réponse du serveur qui doit l'afficher, pas cet écran.
      router.refresh();
    });

  return (
    <PageTemplate
      header={<PageHeader icon={<Palette />} title={t("title")} subtitle={t("subtitle")} />}
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {/* Dit d'emblée ce qui conditionne tout le reste : sans domaine vérifié,
          rien de ce qui suit ne s'affiche à un client. */}
      {state.verifiedAt === null ? (
        <AlertBanner variant="info" title={t("inactiveTitle")}>
          {t("inactiveBody")}
        </AlertBanner>
      ) : null}

      <SettingsSection title={t("domainTitle")} description={t("domainHint")}>
        <div className="flex flex-col gap-4">
          <FormField label={t("domainLabel")} description={t("domainLabelHint")}>
            {(id) => (
              <Input
                id={id}
                value={domain}
                placeholder="panel.revendeur.fr"
                disabled={pending}
                onChange={(event) => setDomain(event.target.value)}
              />
            )}
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => setResellerDomain(domain))}
            >
              {t("declare")}
            </Button>
            <Button
              disabled={pending || state.domain === null}
              onClick={() => run(() => verifyResellerDomain())}
            >
              {t("verify")}
            </Button>

            {state.verifiedAt ? (
              <Badge variant="success">{t("verified")}</Badge>
            ) : state.domain ? (
              <Badge variant="warning">{t("unverified")}</Badge>
            ) : null}

            {state.checkedAt ? (
              <span className="text-muted text-xs">
                {t("lastCheck")} <RelativeTime value={state.checkedAt} />
              </span>
            ) : null}
          </div>

          {/* Le motif d'échec du serveur, tel quel : « TXT introuvable » et
              « CNAME vers autre chose » se corrigent à deux endroits
              différents de la zone. */}
          {state.failure ? (
            <AlertBanner variant="warning" title={t("checkFailed")}>
              {state.failure}
            </AlertBanner>
          ) : null}

          {state.ownershipRecord ? (
            <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface-2 p-4">
              <p className="font-semibold text-fg text-sm">{t("recordsTitle")}</p>
              <DnsRow
                kind="CNAME"
                name={state.domain ?? ""}
                value={state.cnameTarget}
                hint={t("cnameHint")}
              />
              <DnsRow
                kind="TXT"
                name={state.ownershipRecord.name}
                value={state.ownershipRecord.value}
                hint={t("txtHint")}
              />
            </div>
          ) : null}

          {/*
           * Le certificat n'est pas du ressort du panel.
           *
           * Le dire ici plutôt que de laisser le revendeur publier son CNAME,
           * ouvrir son domaine et tomber sur un avertissement de sécurité que
           * rien, dans cet écran, ne lui avait annoncé.
           */}
          <AlertBanner variant="warning" title={t("tlsTitle")}>
            {t("tlsBody")}
          </AlertBanner>
        </div>
      </SettingsSection>

      <SettingsSection title={t("appearanceTitle")} description={t("appearanceHint")}>
        <div className="flex flex-col gap-4">
          <FormField label={t("name")} description={t("nameHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.name}
                disabled={pending}
                onChange={(event) => field("name")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("logo")} description={t("urlHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.logoUrl}
                placeholder="https://cdn.revendeur.fr/logo.webp"
                disabled={pending}
                onChange={(event) => field("logoUrl")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("favicon")} description={t("faviconHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.faviconUrl}
                disabled={pending}
                onChange={(event) => field("faviconUrl")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("accent")} description={t("accentHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.accent}
                placeholder="#0ea5e9"
                disabled={pending}
                onChange={(event) => field("accent")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("loginTagline")} description={t("loginTaglineHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.loginTagline}
                disabled={pending}
                onChange={(event) => field("loginTagline")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("replyTo")} description={t("replyToHint")}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={form.replyTo}
                disabled={pending}
                placeholder="support@exemple.fr"
                onChange={(event) => field("replyTo")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("footer")} description={t("footerHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.footerText}
                disabled={pending}
                onChange={(event) => field("footerText")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("support")} description={t("urlHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.supportUrl}
                disabled={pending}
                onChange={(event) => field("supportUrl")(event.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("terms")} description={t("urlHint")}>
            {(id) => (
              <Input
                id={id}
                value={form.termsUrl}
                disabled={pending}
                onChange={(event) => field("termsUrl")(event.target.value)}
              />
            )}
          </FormField>

          <div>
            <Button disabled={pending} onClick={() => run(() => saveResellerBranding(form))}>
              {tc("save")}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </PageTemplate>
  );
}

/**
 * Un enregistrement à publier, copiable.
 *
 * Copiable et non simplement affiché : un jeton de trente-deux caractères
 * recopié à la main se trompe une fois sur deux, et l'échec de vérification
 * qui s'ensuit se cherche du côté du DNS.
 */
function DnsRow({
  kind,
  name,
  value,
  hint,
}: {
  kind: string;
  name: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{kind}</Badge>
        <code className="font-mono text-fg text-xs">{name}</code>
        <span className="text-muted text-xs">→</span>
        <code className="font-mono text-fg text-xs">{value}</code>
        <CopyButton value={value} />
      </div>
      <p className="text-muted text-xs">{hint}</p>
    </div>
  );
}
