"use client";

import { platformMayProvision } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Button,
  Dialog,
  DialogContent,
  FormField,
  Input,
  SelectMenu,
  SettingToggle,
} from "@gamedashboard/ui";
import { HardDrive, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { AdminLocation, AdminNodeTaxonomy } from "@/server/api/admin";
import { createNode, setNodeOwner } from "@/server/api/admin-actions";
import type { ResellerOption } from "./admin-nodes";

/** Un entier lu depuis un champ texte, ou `null` quand rien d'exploitable. */
function intOf(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Déclaration d'une machine.
 *
 * Ce formulaire n'installe rien : il inscrit un node dans le panel et rend le
 * jeton que Wings devra porter. L'installation du daemon reste une opération
 * faite sur la machine elle-même — le panel ne s'y connecte pas, c'est Wings
 * qui l'appelle.
 */
export function AdminNodeCreate({
  taxonomy,
  locations,
  resellers,
}: {
  taxonomy: AdminNodeTaxonomy;
  locations: AdminLocation[];
  resellers: ResellerOption[];
}) {
  const t = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [fqdn, setFqdn] = useState("");
  const [scheme, setScheme] = useState("https");
  const [daemonPort, setDaemonPort] = useState("8080");
  const [sftpPort, setSftpPort] = useState("2022");
  const [memoryMb, setMemoryMb] = useState("");
  const [diskMb, setDiskMb] = useState("");
  const [cpuCores, setCpuCores] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  // « plateforme » plutôt qu'une chaîne vide : garder la machine est un choix,
  // pas l'absence de choix.
  const [ownerId, setOwnerId] = useState("platform");

  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<{ id: string; secret: string } | null>(null);

  const subcategories = taxonomy.subcategories.filter((s) => s.categoryId === category);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createNode({
        name,
        locationId,
        category,
        subcategory,
        fqdn,
        scheme,
        daemonPort: intOf(daemonPort) ?? 8080,
        daemonSftpPort: intOf(sftpPort) ?? 2022,
        memoryMb: intOf(memoryMb) ?? 0,
        diskMb: intOf(diskMb) ?? 0,
        cpuCores: Number(cpuCores.trim().replace(",", ".")) || 0,
        isPublic,
      });

      if (result.error || !result.token || !result.id) {
        setError(result.error ?? tc("actionRefused"));
        return;
      }

      /*
       * L'attribution se fait en **second appel**, et c'est délibéré.
       *
       * Confier une machine à un revendeur engage sa responsabilité et sort la
       * machine du catalogue public : la règle qui l'encadre — seuls les
       * comptes `reseller`, et le refus expliqué sinon — vit dans une seule
       * route, celle qu'on appelle aussi depuis la liste. La recopier ici
       * ferait deux endroits à corriger le jour où elle change.
       *
       * Un échec ici ne perd rien : le node existe, rangé à la plateforme, et
       * l'attribution se refait depuis sa ligne.
       */
      if (ownerId !== "platform") {
        const assigned = await setNodeOwner(result.id, ownerId);
        if (assigned.error) {
          setError(t("createdButNotAssigned", { reason: assigned.error }));
        }
      }

      setOpen(false);
      setToken(result.token);
      setName("");
      setFqdn("");
      setOwnerId("platform");
      router.refresh();
    });

  // Sans localisation, un node ne peut pas exister : la colonne est obligatoire
  // et la contrainte est en `restrict`. Le dire ici évite un refus de l'API sur
  // un formulaire par ailleurs correctement rempli.
  const blocked = locations.length === 0;

  return (
    <>
      <Button disabled={blocked} onClick={() => setOpen(true)}>
        <Plus /> {t("createNode")}
      </Button>

      {token ? (
        <AlertBanner variant="success" title={t("nodeCreatedTitle")} dismissible>
          <div className="flex flex-col gap-2">
            <p>{t("nodeCreatedBody")}</p>
            <code className="gd-mono select-all break-all rounded-field border border-border bg-surface-2 px-3 py-2 text-fg text-xs">
              token_id: {token.id}
              <br />
              token: {token.secret}
            </code>
          </div>
        </AlertBanner>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("createNode")}
          description={t("createNodeHint")}
          footer={
            <Button
              disabled={
                pending ||
                name.trim() === "" ||
                fqdn.trim() === "" ||
                locationId === "" ||
                intOf(memoryMb) === null ||
                intOf(diskMb) === null
              }
              onClick={submit}
            >
              <HardDrive /> {t("createNodeAction")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {error ? (
              <AlertBanner variant="danger" title={tc("actionRefused")}>
                {error}
              </AlertBanner>
            ) : null}

            <FormField label={t("nodeNameLabel")}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="RYZEN-09"
                />
              )}
            </FormField>

            <FormField label={t("fqdnLabel")} description={t("fqdnHint")}>
              {(id) => (
                <Input
                  id={id}
                  value={fqdn}
                  onChange={(e) => setFqdn(e.target.value)}
                  placeholder="node09.gamedashboard.fr"
                />
              )}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                label={t("schemeLabel")}
                /*
                 * L'avertissement n'apparaît que sur `http`, et il énonce un
                 * fait du navigateur, pas une préférence : depuis un panel
                 * servi en `https`, une console en `ws://` est refusée — par
                 * le contenu mixte d'abord, par notre politique de sécurité
                 * ensuite. Le panel acceptait pourtant de déclarer une telle
                 * machine sans rien dire, et l'on découvrait la chose devant
                 * une console éternellement muette, sans message nulle part.
                 */
                description={scheme === "http" ? t("schemeHttpWarning") : undefined}
              >
                {(id) => (
                  <SelectMenu
                    id={id}
                    value={scheme}
                    onValueChange={setScheme}
                    options={[
                      { value: "https", label: "https" },
                      { value: "http", label: "http" },
                    ]}
                  />
                )}
              </FormField>
              <FormField label={t("daemonPortLabel")}>
                {(id) => (
                  <Input
                    id={id}
                    value={daemonPort}
                    onChange={(e) => setDaemonPort(e.target.value)}
                    inputMode="numeric"
                  />
                )}
              </FormField>
              <FormField label={t("sftpPortLabel")}>
                {(id) => (
                  <Input
                    id={id}
                    value={sftpPort}
                    onChange={(e) => setSftpPort(e.target.value)}
                    inputMode="numeric"
                  />
                )}
              </FormField>
            </div>

            <FormField label={t("locationLabel")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={locationId}
                  onValueChange={setLocationId}
                  options={locations.map((location) => ({
                    value: location.id,
                    label: `${location.short} — ${location.long}`,
                  }))}
                />
              )}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("categoryLabel")}>
                {(id) => (
                  <SelectMenu
                    id={id}
                    value={category}
                    onValueChange={(value) => {
                      setCategory(value);
                      // La sous-catégorie retenue n'appartient plus à la
                      // nouvelle catégorie : la garder produirait un node rangé
                      // sous un intitulé qui n'existe pas là.
                      setSubcategory("");
                    }}
                    options={[
                      { value: "", label: t("unclassified") },
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
                    disabled={category === "" || subcategories.length === 0}
                    options={[
                      { value: "", label: t("unclassified") },
                      ...subcategories.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                )}
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label={t("memoryLabel")} description="Mo">
                {(id) => (
                  <Input
                    id={id}
                    value={memoryMb}
                    onChange={(e) => setMemoryMb(e.target.value)}
                    inputMode="numeric"
                    placeholder="65536"
                  />
                )}
              </FormField>
              <FormField label={t("diskLabel")} description="Mo">
                {(id) => (
                  <Input
                    id={id}
                    value={diskMb}
                    onChange={(e) => setDiskMb(e.target.value)}
                    inputMode="numeric"
                    placeholder="512000"
                  />
                )}
              </FormField>
              <FormField label={t("cpuLabel")} description={t("cpuHint")}>
                {(id) => (
                  <Input
                    id={id}
                    value={cpuCores}
                    onChange={(e) => setCpuCores(e.target.value)}
                    inputMode="decimal"
                    placeholder="16"
                  />
                )}
              </FormField>
            </div>

            <FormField label={t("owner")} description={t("ownerCreateHint")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={ownerId}
                  onValueChange={setOwnerId}
                  options={[
                    { value: "platform", label: t("nodePlatform"), description: t("platformHint") },
                    ...resellers.map((reseller) => ({
                      value: reseller.id,
                      label: reseller.name,
                      // Ce que le revendeur autorise est une information, pas
                      // une condition : on la montre au moment de décider.
                      description: platformMayProvision(reseller.platformAccess)
                        ? t("resellerAllows")
                        : t("resellerRefuses"),
                    })),
                  ]}
                />
              )}
            </FormField>

            {/* Une machine confiée à un revendeur quitte le catalogue public :
                les deux réglages se contredisent, et le dire vaut mieux que de
                laisser l'un défaire l'autre en silence. */}
            {ownerId !== "platform" && isPublic ? (
              <AlertBanner variant="info" title={t("assignToReseller")}>
                {t("assignConsequence")}
              </AlertBanner>
            ) : null}

            <SettingToggle
              label={t("publicLabel")}
              description={t("publicHint")}
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
