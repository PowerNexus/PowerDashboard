"use client";

import { AlertBanner, Button, ConfirmDialog, PageHeader, PageTemplate } from "@gamedashboard/ui";
import { Egg, Save, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useEggDraft } from "@/lib/use-egg-draft";
import type { AdminEggDetail } from "@/server/api/admin";
import { AdminEggAdvanced } from "./admin-egg-advanced";
import { AdminEggExportButton } from "./admin-egg-export-button";
import { AdminEggIdentity } from "./admin-egg-identity";
import { AdminEggImages } from "./admin-egg-images";
import { AdminEggInstall } from "./admin-egg-install";
import { AdminEggStartup } from "./admin-egg-startup";
import { AdminEggVariables } from "./admin-egg-variables";

/**
 * Éditeur d'egg, en sections nommées.
 *
 * Un egg employé par des serveurs reste modifiable : on prévient, on ne bloque
 * pas. Ce qui casserait un serveur en service est refusé par l'API, et
 * l'écran le signale déjà sur la variable concernée.
 */
export function AdminEggEditor({ egg }: { egg: AdminEggDetail }) {
  const t = useTranslations("adminEggEditor");
  const state = useEggDraft(egg);
  const [confirming, setConfirming] = useState(false);

  // Un egg en service demande confirmation : ce qu'on change s'appliquera aux
  // serveurs à leur prochaine installation ou à leur prochain démarrage.
  const requestSave = () => (egg.servers > 0 ? setConfirming(true) : state.save());

  const actions = (
    <div className="flex flex-wrap gap-2">
      <AdminEggExportButton eggId={egg.id} />
      <Button variant="ghost" disabled={state.pending} onClick={state.reset}>
        <Undo2 /> {t("reset")}
      </Button>
      <Button loading={state.pending} onClick={requestSave}>
        <Save /> {t("save")}
      </Button>
    </div>
  );

  return (
    <PageTemplate
      width="readable"
      header={
        <PageHeader
          icon={<Egg />}
          title={egg.name}
          subtitle={t("subtitle", { nest: egg.nest })}
          breadcrumbs={[{ label: t("catalogue"), href: "/admin/eggs" }, { label: egg.name }]}
          actions={actions}
        />
      }
    >
      {state.error ? (
        <AlertBanner variant="danger" title={t("saveRefused")} dismissible>
          {state.error}
        </AlertBanner>
      ) : null}
      {state.saved ? <AlertBanner variant="success">{t("savedBody")}</AlertBanner> : null}
      {egg.servers > 0 ? (
        <AlertBanner variant="warning" title={t("inUseTitle", { count: egg.servers })}>
          {t("inUseBody")}
        </AlertBanner>
      ) : null}
      {egg.sourceRef && !egg.locallyModified ? (
        <AlertBanner variant="info">{t("detachNotice")}</AlertBanner>
      ) : null}

      <AdminEggIdentity state={state} />
      <AdminEggStartup state={state} />
      <AdminEggImages state={state} />
      <AdminEggVariables state={state} stored={egg.variables} />
      <AdminEggInstall state={state} />
      <AdminEggAdvanced state={state} />

      <div className="flex justify-end">{actions}</div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("confirmTitle", { count: egg.servers })}
        description={t("confirmBody")}
        confirmLabel={t("save")}
        cancelLabel={t("cancel")}
        loading={state.pending}
        onConfirm={() => {
          setConfirming(false);
          state.save();
        }}
      />
    </PageTemplate>
  );
}
