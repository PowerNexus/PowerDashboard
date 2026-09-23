"use client";

import { platformMayProvision } from "@gamedashboard/contracts";
import { AlertBanner, Button, FormField, SelectMenu, SettingsSection } from "@gamedashboard/ui";
import { Layers, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setNodeOwner } from "@/server/api/admin-actions";
import type { AdminNodeDetail } from "@/server/api/admin-node";
import { AdminNodeShares } from "./admin-node-shares";
import type { ResellerOption } from "./admin-nodes";

/**
 * Revendeurs : qui exploite la machine, ou comment elle se partage.
 *
 * Deux gestes exclusifs, et l'écran le dit : confier la machine entière à un
 * revendeur, ou la découper en parts entre plusieurs. Une machine confiée
 * en entier ne se découpe pas ; il faut d'abord la rendre à la plateforme.
 */
export function AdminNodeResellers({
  node,
  resellers,
}: {
  node: AdminNodeDetail;
  resellers: ResellerOption[];
}) {
  const t = useTranslations("nodeAdmin");
  const ta = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assignee, setAssignee] = useState(node.ownerId ?? "platform");
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const save = () =>
    startTransition(async () => {
      const result = await setNodeOwner(node.id, assignee === "platform" ? null : assignee);
      setError(result.error);
      if (!result.error) router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={t("operatorTitle")}
        description={ta("ownerHint")}
        footer={
          <Button disabled={pending || assignee === (node.ownerId ?? "platform")} onClick={save}>
            <Save /> {tc("save")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {error ? (
            <AlertBanner variant="danger" title={tc("actionRefused")}>
              {error}
            </AlertBanner>
          ) : null}
          {resellers.length === 0 ? (
            <AlertBanner variant="info">{ta("noResellers")}</AlertBanner>
          ) : null}
          <FormField label={ta("owner")}>
            {(id) => (
              <SelectMenu
                id={id}
                value={assignee}
                onValueChange={setAssignee}
                options={[
                  { value: "platform", label: ta("nodePlatform"), description: ta("platformHint") },
                  ...resellers.map((reseller) => ({
                    value: reseller.id,
                    label: reseller.name,
                    // Ce que le revendeur autorise est une information, pas une
                    // condition : on la montre au moment de décider.
                    description: platformMayProvision(reseller.platformAccess)
                      ? ta("resellerAllows")
                      : ta("resellerRefuses"),
                  })),
                ]}
              />
            )}
          </FormField>
          {assignee !== "platform" ? (
            <AlertBanner variant="warning">{ta("assignConsequence")}</AlertBanner>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("sharesSectionTitle")}
        description={ta("sharesHint")}
        footer={
          <Button
            variant="secondary"
            disabled={node.ownerId !== null}
            onClick={() => setSharing(true)}
          >
            <Layers /> {ta("manageShares")}
          </Button>
        }
      >
        {node.ownerId !== null ? (
          <AlertBanner variant="info" title={ta("sharesBlockedTitle")}>
            {ta("sharesBlockedBody")}
          </AlertBanner>
        ) : (
          <p className="text-muted text-sm">{t("sharesSectionBody")}</p>
        )}
      </SettingsSection>

      {sharing ? (
        <AdminNodeShares
          node={{
            id: node.id,
            name: node.name,
            memoryMb: node.memoryMb,
            diskMb: node.diskMb,
            ownerId: node.ownerId,
          }}
          resellers={resellers}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </div>
  );
}
