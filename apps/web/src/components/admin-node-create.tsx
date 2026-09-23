"use client";

import { platformMayProvision } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Button,
  FormField,
  Input,
  SelectMenu,
  SettingToggle,
} from "@gamedashboard/ui";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { AdminLocation, AdminNodeTaxonomy } from "@/server/api/admin";
import { createNode, setNodeOwner } from "@/server/api/admin-actions";
import type { ResellerOption } from "./admin-nodes";

/**
 * « Non classée », en valeur de liste.
 *
 * La liste déroulante (Radix) refuse la chaîne vide comme valeur : elle
 * affichait « Sélectionner… » au lieu de « Non classée ». Une sentinelle qui ne
 * peut pas être un identifiant de catégorie — elles sont en minuscules et
 * tirets — la remplace, et redevient `null` à l'envoi.
 */
const UNCLASSIFIED = "__none__";

/** Un entier lu depuis un champ texte, ou `null` quand rien d'exploitable. */
function intOf(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Étape 1 du parcours « Ajouter une machine » : la déclarer au panel.
 *
 * Ce formulaire n'installe rien : il inscrit la machine et lui tire un jeton.
 * L'installation du daemon se fait ensuite sur la machine elle-même — le panel
 * ne s'y connecte pas, c'est Wings qui l'appelle. Chaque champ dit à quoi il
 * sert et donne un exemple : un administrateur qui n'a jamais vu Pterodactyl
 * ne sait pas qu'un port « daemon » et un port « SFTP » sont deux choses.
 */
export function AdminNodeDeclareForm({
  taxonomy,
  locations,
  resellers,
  onDeclared,
}: {
  taxonomy: AdminNodeTaxonomy;
  locations: AdminLocation[];
  resellers: ResellerOption[];
  /** `warning` : la machine existe, mais l'attribution au revendeur a échoué. */
  onDeclared: (node: { id: string; name: string; warning: string | null }) => void;
}) {
  const t = useTranslations("nodeAdmin");
  const ta = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [category, setCategory] = useState(UNCLASSIFIED);
  const [subcategory, setSubcategory] = useState(UNCLASSIFIED);
  const [fqdn, setFqdn] = useState("");
  const [scheme, setScheme] = useState("https");
  const [daemonPort, setDaemonPort] = useState("8080");
  const [sftpPort, setSftpPort] = useState("2022");
  const [memoryMb, setMemoryMb] = useState("");
  const [diskMb, setDiskMb] = useState("");
  const [cpuCores, setCpuCores] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  // « plateforme » plutôt qu'une chaîne vide : garder la machine est un choix.
  const [ownerId, setOwnerId] = useState("platform");
  const [error, setError] = useState<string | null>(null);

  const subcategories = taxonomy.subcategories.filter((s) => s.categoryId === category);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createNode({
        name,
        locationId,
        // L'API attend une chaîne vide pour « non classée ».
        category: category === UNCLASSIFIED ? "" : category,
        subcategory: subcategory === UNCLASSIFIED ? "" : subcategory,
        fqdn,
        scheme,
        daemonPort: intOf(daemonPort) ?? 8080,
        daemonSftpPort: intOf(sftpPort) ?? 2022,
        memoryMb: intOf(memoryMb) ?? 0,
        diskMb: intOf(diskMb) ?? 0,
        cpuCores: Number(cpuCores.trim().replace(",", ".")) || 0,
        isPublic,
      });
      if (result.error || !result.id) {
        setError(result.error ?? tc("actionRefused"));
        return;
      }

      /*
       * L'attribution est un second appel : la règle qui l'encadre — seuls les
       * comptes revendeurs, refus expliqué sinon — vit dans une seule route.
       * Un échec ne perd rien : la machine existe, rangée à la plateforme, et
       * l'attribution se refait depuis sa fiche.
       */
      const assigned =
        ownerId === "platform" ? { error: null } : await setNodeOwner(result.id, ownerId);
      onDeclared({
        id: result.id,
        name: name.trim(),
        warning: assigned.error ? ta("createdButNotAssigned", { reason: assigned.error }) : null,
      });
    });

  const ready =
    name.trim() !== "" &&
    fqdn.trim() !== "" &&
    locationId !== "" &&
    intOf(memoryMb) !== null &&
    intOf(diskMb) !== null;

  const field = (
    label: string,
    hint: string,
    value: string,
    set: (v: string) => void,
    placeholder?: string,
    numeric = false,
  ) => (
    <FormField label={label} description={hint}>
      {(id) => (
        <Input
          id={id}
          className={numeric ? "gd-mono" : undefined}
          inputMode={numeric ? "numeric" : undefined}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </FormField>
  );

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")}>
          {error}
        </AlertBanner>
      ) : null}

      {field(t("nameLabel"), t("nameHint"), name, setName, "RYZEN-09")}
      {field(t("fqdn"), t("fqdnCreateHint"), fqdn, setFqdn, "node09.exemple.fr")}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          label={t("protocol")}
          description={scheme === "http" ? t("protocolHttpWarning") : t("protocolHint")}
        >
          {(id) => (
            <SelectMenu
              id={id}
              value={scheme}
              onValueChange={setScheme}
              options={[
                { value: "https", label: t("protocolHttps") },
                { value: "http", label: t("protocolHttp") },
              ]}
            />
          )}
        </FormField>
        {field(t("daemonPort"), t("daemonPortHint"), daemonPort, setDaemonPort, "8080", true)}
        {field(t("sftpPort"), t("sftpPortHint"), sftpPort, setSftpPort, "2022", true)}
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("categoryLabel")} description={t("categoryHint")}>
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

      <div className="grid gap-4 sm:grid-cols-3">
        {field(t("memoryLabel"), t("memoryCreateHint"), memoryMb, setMemoryMb, "65536", true)}
        {field(t("diskLabel"), t("diskCreateHint"), diskMb, setDiskMb, "512000", true)}
        {field(t("cpuLabel"), t("cpuHint"), cpuCores, setCpuCores, "16", true)}
      </div>

      <FormField label={ta("owner")} description={t("ownerCreateHint")}>
        {(id) => (
          <SelectMenu
            id={id}
            value={ownerId}
            onValueChange={setOwnerId}
            options={[
              { value: "platform", label: ta("nodePlatform"), description: ta("platformHint") },
              ...resellers.map((reseller) => ({
                value: reseller.id,
                label: reseller.name,
                description: platformMayProvision(reseller.platformAccess)
                  ? ta("resellerAllows")
                  : ta("resellerRefuses"),
              })),
            ]}
          />
        )}
      </FormField>
      {ownerId !== "platform" ? (
        <AlertBanner variant="info">{ta("assignConsequence")}</AlertBanner>
      ) : null}

      <SettingToggle
        label={t("publicLabel")}
        description={t("publicHint")}
        checked={isPublic}
        onCheckedChange={setIsPublic}
      />

      <Button className="self-end" disabled={pending || !ready} onClick={submit}>
        {t("declareAction")} <ArrowRight />
      </Button>
    </div>
  );
}
