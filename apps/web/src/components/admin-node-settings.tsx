"use client";

import { capacityRefusals, nodeCapacityMb } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Button,
  FormField,
  formatMb,
  Input,
  SelectMenu,
  SettingsSection,
  SettingToggle,
} from "@gamedashboard/ui";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { AdminLocation, AdminNodeTaxonomy } from "@/server/api/admin";
import type { AdminNodeDetail } from "@/server/api/admin-node";
import { saveNodeSettings } from "@/server/api/admin-node-actions";
import { AdminNodeBinding } from "./admin-node-binding";

/**
 * « Non classée », en valeur de liste.
 *
 * La liste déroulante (Radix) refuse la chaîne vide comme valeur : elle
 * affichait « Sélectionner… » au lieu de « Non classée ». Une sentinelle qui ne
 * peut pas être un identifiant de catégorie — elles sont en minuscules et
 * tirets — la remplace, et redevient `null` à l'envoi.
 */
const UNCLASSIFIED = "__none__";

/** Un entier positif lu depuis un champ, ou `null`. */
function intOf(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Réglages d'un node, en deux blocs qui ne suivent pas le même chemin.
 *
 * Le premier ne concerne **que le panel** : rien ne part vers la machine, et
 * l'enregistrement est immédiat. Le second — adresse et ports — vit aussi dans
 * le `config.yml` de la machine ; il a son propre bloc et sa propre
 * explication, parce qu'une erreur y coupe le panel de son daemon.
 */
export function AdminNodeSettings({
  detail,
  taxonomy,
  locations,
}: {
  detail: AdminNodeDetail;
  taxonomy: AdminNodeTaxonomy;
  locations: AdminLocation[];
}) {
  const t = useTranslations("nodeAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(detail.name);
  const [locationId, setLocationId] = useState(detail.locationId);
  const [category, setCategory] = useState(detail.category ?? UNCLASSIFIED);
  const [subcategory, setSubcategory] = useState(detail.subcategory ?? UNCLASSIFIED);
  const [memoryMb, setMemoryMb] = useState(String(detail.memoryMb));
  const [memoryOver, setMemoryOver] = useState(String(detail.memoryOverallocate));
  const [diskMb, setDiskMb] = useState(String(detail.diskMb));
  const [diskOver, setDiskOver] = useState(String(detail.diskOverallocate));
  const [cpuCores, setCpuCores] = useState(String(detail.cpuCores));
  const [isPublic, setIsPublic] = useState(detail.isPublic);

  const numbers = {
    memoryMb: intOf(memoryMb),
    memoryOverallocate: intOf(memoryOver),
    diskMb: intOf(diskMb),
    diskOverallocate: intOf(diskOver),
  };
  const complete = Object.values(numbers).every((v) => v !== null);
  /*
   * La règle de l'API, appliquée pendant la saisie : baisser la capacité sous
   * ce qui est promis aux serveurs sera refusé, et le dire avant le clic évite
   * de le découvrir après.
   */
  const refusals = complete
    ? capacityRefusals(numbers as Record<keyof typeof numbers, number>, {
        memoryMb: detail.memoryAllocatedMb,
        diskMb: detail.diskAllocatedMb,
      })
    : [];
  const cpu = Number(cpuCores.trim().replace(",", "."));
  const subcategories = taxonomy.subcategories.filter((s) => s.categoryId === category);

  const submit = () =>
    startTransition(async () => {
      setSaved(false);
      const result = await saveNodeSettings(detail.id, {
        name: name.trim(),
        locationId,
        category: category === UNCLASSIFIED ? null : category,
        subcategory: subcategory === UNCLASSIFIED ? null : subcategory,
        memoryMb: numbers.memoryMb ?? 0,
        memoryOverallocate: numbers.memoryOverallocate ?? 0,
        diskMb: numbers.diskMb ?? 0,
        diskOverallocate: numbers.diskOverallocate ?? 0,
        cpuCores: cpu,
        isPublic,
      });
      setError(result.error);
      setSaved(result.error === null);
      if (!result.error) router.refresh();
    });

  const capacityField = (
    label: string,
    value: string,
    set: (v: string) => void,
    over: string,
    setOver: (v: string) => void,
    promised: number,
  ) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField
        label={label}
        description={t("capacityFloor", { promised: formatMb(promised, 0) })}
      >
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            className="gd-mono"
            value={value}
            onChange={(e) => set(e.target.value)}
          />
        )}
      </FormField>
      <FormField
        label={t("overallocateLabel")}
        description={t("overallocateHint", {
          total: formatMb(nodeCapacityMb(intOf(value) ?? 0, intOf(over) ?? 0), 0),
        })}
      >
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            className="gd-mono"
            value={over}
            onChange={(e) => setOver(e.target.value)}
          />
        )}
      </FormField>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={t("settingsPanelTitle")}
        description={t("settingsPanelHint")}
        footer={
          <Button
            disabled={pending || !name.trim() || !complete || refusals.length > 0 || !(cpu > 0)}
            onClick={submit}
          >
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
          {saved ? <AlertBanner variant="success">{t("settingsSaved")}</AlertBanner> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("nameLabel")} description={t("nameHint")}>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
            </FormField>
            <FormField label={t("location")} description={t("locationHint")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={locationId}
                  onValueChange={setLocationId}
                  options={locations.map((l) => ({ value: l.id, label: `${l.short} — ${l.long}` }))}
                />
              )}
            </FormField>
            <FormField label={t("categoryLabel")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={category}
                  onValueChange={(value) => {
                    setCategory(value);
                    setSubcategory(UNCLASSIFIED);
                  }}
                  options={[
                    { value: UNCLASSIFIED, label: t("unclassified") },
                    ...taxonomy.categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              )}
            </FormField>
            <FormField label={t("subcategoryLabel")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={subcategory}
                  onValueChange={setSubcategory}
                  disabled={category === UNCLASSIFIED || subcategories.length === 0}
                  options={[
                    { value: UNCLASSIFIED, label: t("unclassified") },
                    ...subcategories.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              )}
            </FormField>
          </div>
          {capacityField(
            t("memoryLabel"),
            memoryMb,
            setMemoryMb,
            memoryOver,
            setMemoryOver,
            detail.memoryAllocatedMb,
          )}
          {capacityField(
            t("diskLabel"),
            diskMb,
            setDiskMb,
            diskOver,
            setDiskOver,
            detail.diskAllocatedMb,
          )}
          {refusals.length > 0 ? (
            <AlertBanner variant="warning" title={t("capacityTooLowTitle")}>
              {refusals
                .map((r) =>
                  t("capacityTooLow", {
                    resource: t(r.resource === "memory" ? "memoryLabel" : "diskLabel"),
                    capacity: formatMb(r.capacityMb, 0),
                    promised: formatMb(r.allocatedMb, 0),
                  }),
                )
                .join(" ")}
            </AlertBanner>
          ) : null}
          <FormField label={t("cpuLabel")} description={t("cpuHint")}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className="gd-mono sm:max-w-40"
                value={cpuCores}
                onChange={(e) => setCpuCores(e.target.value)}
              />
            )}
          </FormField>
          <SettingToggle
            label={t("publicLabel")}
            description={t("publicHint")}
            checked={isPublic}
            onCheckedChange={setIsPublic}
          />
        </div>
      </SettingsSection>

      <AdminNodeBinding detail={detail} />
    </div>
  );
}
