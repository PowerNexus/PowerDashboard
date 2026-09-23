"use client";

import {
  bindingChanges,
  bindingProblemCode,
  type NodeBindingInput,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  FormField,
  Input,
  SelectMenu,
  SettingsSection,
} from "@gamedashboard/ui";
import { Download, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { AdminNodeDetail } from "@/server/api/admin-node";
import { type BindingOutcome, saveNodeBinding } from "@/server/api/admin-node-actions";

/** Enregistre un texte comme fichier, sans repasser par le serveur. */
export function downloadText(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/yaml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Adresse et ports : ce qui vit **aussi** dans le `config.yml` de la machine.
 *
 * L'écran dit avant le clic ce qui va se passer, et après le clic ce qui s'est
 * passé — car l'issue ordinaire n'est pas toujours « enregistré ». Wings ne
 * rouvre ses ports qu'à son redémarrage : le panel lui remet la nouvelle
 * configuration, puis n'enregistre la nouvelle adresse qu'une fois qu'il y
 * répond. Voir `docs/runbooks/modifier-liaison-node.md`.
 */
export function AdminNodeBinding({ detail }: { detail: AdminNodeDetail }) {
  const t = useTranslations("nodeAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fqdn, setFqdn] = useState(detail.fqdn);
  const [scheme, setScheme] = useState<"http" | "https">(detail.scheme);
  const [daemonPort, setDaemonPort] = useState(String(detail.daemonPort));
  const [sftpPort, setSftpPort] = useState(String(detail.daemonSftpPort));
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BindingOutcome | null>(null);

  const target: NodeBindingInput = {
    fqdn: fqdn.trim().toLowerCase(),
    scheme,
    daemonPort: Number(daemonPort),
    daemonSftpPort: Number(sftpPort),
  };
  const portsValid = [target.daemonPort, target.daemonSftpPort].every(
    (p) => Number.isInteger(p) && p >= 1 && p <= 65_535,
  );
  const changed = portsValid ? bindingChanges(detail, target) : [];
  const problem = portsValid && target.fqdn ? bindingProblemCode(target) : null;

  const submit = () =>
    startTransition(async () => {
      const result = await saveNodeBinding(detail.id, target);
      setError(result.error);
      setOutcome(result.outcome);
      if (result.outcome?.status === "applied") router.refresh();
    });

  return (
    <SettingsSection
      title={t("bindingTitle")}
      description={t("bindingHint")}
      footer={
        <Button
          disabled={
            pending || !portsValid || !target.fqdn || problem !== null || changed.length === 0
          }
          onClick={submit}
        >
          <Send /> {outcome?.status === "restart_required" ? t("bindingRetry") : t("bindingApply")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <AlertBanner variant="info" title={t("bindingHowTitle")}>
          <ol className="list-decimal pl-5">
            <li>{t("bindingHowPush")}</li>
            <li>{t("bindingHowCheck")}</li>
            <li>{t("bindingHowRestart")}</li>
          </ol>
        </AlertBanner>

        <FormField label={t("fqdn")} description={t("fqdnHint")}>
          {(id) => (
            <Input
              id={id}
              className="gd-mono"
              value={fqdn}
              onChange={(e) => setFqdn(e.target.value)}
              placeholder="node1.exemple.fr"
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            label={t("protocol")}
            description={scheme === "http" ? t("protocolHttpWarning") : t("protocolHint")}
          >
            {(id) => (
              <SelectMenu
                id={id}
                value={scheme}
                onValueChange={(v) => setScheme(v as "http" | "https")}
                options={[
                  { value: "https", label: t("protocolHttps") },
                  { value: "http", label: t("protocolHttp") },
                ]}
              />
            )}
          </FormField>
          <FormField label={t("daemonPort")} description={t("daemonPortHint")}>
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="gd-mono"
                value={daemonPort}
                onChange={(e) => setDaemonPort(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("sftpPort")} description={t("sftpPortHint")}>
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="gd-mono"
                value={sftpPort}
                onChange={(e) => setSftpPort(e.target.value)}
              />
            )}
          </FormField>
        </div>

        {problem ? (
          <AlertBanner variant="warning">{t(`bindingProblem.${problem}`)}</AlertBanner>
        ) : null}
        {changed.length > 0 ? (
          <p className="flex flex-wrap items-center gap-2 text-muted text-xs">
            {t("bindingChanged")}
            {changed.map((field) => (
              <Badge key={field} variant="accent">
                {t(`bindingField.${field}`)}
              </Badge>
            ))}
          </p>
        ) : null}

        {error ? (
          <AlertBanner variant="danger" title={tc("actionRefused")}>
            {error}
          </AlertBanner>
        ) : null}
        {outcome ? <BindingOutcomeBanner outcome={outcome} /> : null}
      </div>
    </SettingsSection>
  );
}

/** L'issue, dite avec ce qu'il faut faire ensuite. */
function BindingOutcomeBanner({ outcome }: { outcome: BindingOutcome }) {
  const t = useTranslations("nodeAdmin");

  if (outcome.status === "applied") {
    return <AlertBanner variant="success">{t("bindingApplied")}</AlertBanner>;
  }
  if (outcome.status === "unchanged") {
    return <AlertBanner variant="info">{t("bindingUnchanged")}</AlertBanner>;
  }
  if (outcome.status === "restart_required") {
    return (
      <AlertBanner variant="warning" title={t("bindingRestartTitle")}>
        <p>{t("bindingRestartBody")}</p>
        <code className="gd-mono mt-2 block select-all rounded-field border border-border bg-surface-2 px-3 py-2 text-fg text-xs">
          systemctl restart wings
        </code>
      </AlertBanner>
    );
  }
  return (
    <AlertBanner variant="danger" title={t("bindingRefusedTitle")}>
      <p>{outcome.failure}</p>
      <p className="mt-2">{t("bindingRefusedBody")}</p>
      {outcome.file ? (
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          onClick={() => downloadText(outcome.file ?? "", "config.yml")}
        >
          <Download /> {t("downloadConfig")}
        </Button>
      ) : null}
    </AlertBanner>
  );
}
