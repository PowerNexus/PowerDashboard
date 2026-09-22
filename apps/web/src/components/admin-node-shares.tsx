"use client";

import {
  AlertBanner,
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  FormField,
  formatMb,
  Input,
  MetricBar,
  SelectMenu,
} from "@gamedashboard/ui";
import { Plus, Store, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import type { AdminNodeShare } from "@/server/api/admin";
import { loadNodeShares, removeNodeShare, setNodeShare } from "@/server/api/admin-actions";
import type { ResellerOption } from "./admin-nodes";

/** Un entier lu depuis un champ texte, ou `null` quand rien d'exploitable. */
function intOf(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Répartition d'une machine entre plusieurs revendeurs.
 *
 * Un dédié peut porter trois, quatre, cinq revendeurs, chacun avec sa part. La
 * fenêtre montre ce que chacun détient **et ce qu'il occupe** : réduire une
 * part à 16 Go alors que 24 sont déjà pris est un geste dont il faut voir la
 * conséquence avant de le faire, pas après.
 *
 * La somme des parts peut dépasser la capacité de la machine, et c'est voulu :
 * le plafond porte sur la consommation réelle, pas sur les limites accordées
 * aux serveurs. Interdire le surprovisionnement interdirait la revente.
 */
export function AdminNodeShares({
  node,
  resellers,
  onClose,
}: {
  node: { id: string; name: string; memoryMb: number; diskMb: number; ownerId: string | null };
  resellers: ResellerOption[];
  onClose: () => void;
}) {
  const t = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [shares, setShares] = useState<AdminNodeShare[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [resellerId, setResellerId] = useState("");
  const [memoryMb, setMemoryMb] = useState("");
  const [diskMb, setDiskMb] = useState("");
  const [serversMax, setServersMax] = useState("");

  /*
   * Les parts sont chargées à l'ouverture, pas avec la liste des machines.
   *
   * Chaque part demande un calcul de consommation ; les charger pour tout le
   * parc ferait ce travail pour des fenêtres qu'on n'ouvrira pas.
   */
  useEffect(() => {
    let cancelled = false;
    void loadNodeShares(node.id).then((result) => {
      if (cancelled) return;
      setError(result.error);
      setShares(result.shares);
    });
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const refresh = async () => {
    const result = await loadNodeShares(node.id);
    setShares(result.shares);
    router.refresh();
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await setNodeShare(node.id, {
        resellerId,
        memoryMb: intOf(memoryMb) ?? 0,
        diskMb: intOf(diskMb) ?? 0,
        // Champ vide : aucun plafond sur le nombre de serveurs. `null` est une
        // valeur, pas une absence de saisie.
        serversMax: serversMax.trim() === "" ? null : (intOf(serversMax) ?? 0),
      });

      if (result.error) {
        setError(result.error);
        return;
      }
      setResellerId("");
      setMemoryMb("");
      setDiskMb("");
      setServersMax("");
      await refresh();
    });

  const drop = (share: AdminNodeShare) =>
    startTransition(async () => {
      setError(null);
      const result = await removeNodeShare(node.id, share.resellerId);
      if (result.error) setError(result.error);
      else await refresh();
    });

  /** Édite une part existante en pré-remplissant le formulaire. */
  const edit = (share: AdminNodeShare) => {
    setResellerId(share.resellerId);
    setMemoryMb(String(share.memoryMb));
    setDiskMb(String(share.diskMb));
    setServersMax(share.serversMax === null ? "" : String(share.serversMax));
  };

  const allocatedMemory = (shares ?? []).reduce((sum, share) => sum + share.memoryMb, 0);
  const available = resellers.filter(
    (reseller) => !(shares ?? []).some((share) => share.resellerId === reseller.id),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="lg"
        title={t("sharesTitle", { name: node.name })}
        description={t("sharesHint")}
      >
        <div className="flex flex-col gap-5">
          {error ? (
            <AlertBanner variant="danger" title={tc("actionRefused")}>
              {error}
            </AlertBanner>
          ) : null}

          {/* Une machine confiée en entier ne se découpe pas : les deux notions
              se contrediraient, et rien ne dirait laquelle fait foi. */}
          {node.ownerId ? (
            <AlertBanner variant="warning" title={t("sharesBlockedTitle")}>
              {t("sharesBlockedBody")}
            </AlertBanner>
          ) : null}

          {shares === null ? (
            <p className="text-muted text-sm">{tc("loading")}</p>
          ) : shares.length === 0 ? (
            <EmptyState icon={<Store />} title={t("noShare")} description={t("noShareHint")} />
          ) : (
            <div className="flex flex-col gap-3">
              {shares.map((share) => {
                const over = share.usage.memoryMb > share.memoryMb;
                return (
                  <div key={share.id} className="rounded-field border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-fg text-sm">{share.resellerName}</span>
                      {over ? (
                        <Badge variant="danger">
                          <TriangleAlert className="size-3" /> {t("shareOver")}
                        </Badge>
                      ) : null}
                      {/*
                       * L'origine du chiffre est dite quand elle n'est pas une
                       * mesure. Comparer un plafond à une estimation n'autorise
                       * pas les mêmes décisions que le comparer à un relevé.
                       */}
                      {share.usage.basis !== "measured" ? (
                        <Badge variant="neutral">
                          {t(`basis.${share.usage.basis}`, { count: share.usage.unmeasured })}
                        </Badge>
                      ) : null}
                      <span className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => edit(share)}
                        >
                          {t("shareEdit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          aria-label={t("shareRemove", { name: share.resellerName })}
                          onClick={() => drop(share)}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <MetricBar
                        label={t("memory")}
                        value={share.usage.memoryMb}
                        max={share.memoryMb}
                        format={(value) => formatMb(value, 0)}
                      />
                      <MetricBar
                        label={t("diskLabel")}
                        value={share.usage.diskMb}
                        max={share.diskMb}
                        format={(value) => formatMb(value, 0)}
                      />
                    </div>

                    <p className="mt-2 text-faint text-xs">
                      {t("shareServers", {
                        count: share.usage.servers,
                        max: share.serversMax === null ? t("unlimited") : String(share.serversMax),
                      })}
                    </p>
                  </div>
                );
              })}

              {/*
               * La somme des parts est rappelée, sans être interdite de
               * dépasser : vendre plus qu'on ne détient est le modèle, pas une
               * erreur. Le dire permet de le faire en connaissance de cause.
               */}
              <p className="text-muted text-xs">
                {t("sharesTotal", {
                  allocated: formatMb(allocatedMemory, 0),
                  capacity: formatMb(node.memoryMb, 0),
                })}
                {allocatedMemory > node.memoryMb ? ` — ${t("sharesOversold")}` : ""}
              </p>
            </div>
          )}

          {/* --- Poser ou modifier une part --- */}
          {node.ownerId ? null : (
            <div className="flex flex-col gap-4 border-border border-t pt-5">
              <h3 className="font-semibold text-fg text-sm">{t("shareForm")}</h3>

              <FormField label={t("owner")}>
                {(id) => (
                  <SelectMenu
                    id={id}
                    value={resellerId}
                    onValueChange={setResellerId}
                    options={[
                      { value: "", label: t("sharePickReseller"), disabled: true },
                      // Les revendeurs déjà servis restent proposés quand on
                      // vient de cliquer « Modifier » : sinon le formulaire
                      // pré-rempli pointerait un choix absent de la liste.
                      ...resellers
                        .filter(
                          (reseller) =>
                            reseller.id === resellerId ||
                            available.some((candidate) => candidate.id === reseller.id),
                        )
                        .map((reseller) => ({
                          value: reseller.id,
                          label: reseller.name,
                          description: reseller.email,
                        })),
                    ]}
                  />
                )}
              </FormField>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label={t("memoryLabel")} description="Mo">
                  {(id) => (
                    <Input
                      id={id}
                      value={memoryMb}
                      onChange={(e) => setMemoryMb(e.target.value)}
                      inputMode="numeric"
                      placeholder="32768"
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
                      placeholder="256000"
                    />
                  )}
                </FormField>
                <FormField label={t("shareServersMax")} description={t("shareServersMaxHint")}>
                  {(id) => (
                    <Input
                      id={id}
                      value={serversMax}
                      onChange={(e) => setServersMax(e.target.value)}
                      inputMode="numeric"
                      placeholder={t("unlimited")}
                    />
                  )}
                </FormField>
              </div>

              <Button
                className="self-start"
                disabled={
                  pending || resellerId === "" || intOf(memoryMb) === null || intOf(diskMb) === null
                }
                onClick={submit}
              >
                <Plus /> {t("shareSave")}
              </Button>

              {resellers.length === 0 ? (
                <p className="text-muted text-xs">{t("noResellers")}</p>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
