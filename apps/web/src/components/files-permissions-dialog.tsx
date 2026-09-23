"use client";

import {
  bitsToMode,
  FileMode,
  type ModeBits,
  modeToBits,
  octalFromSymbolic,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Button,
  Dialog,
  DialogContent,
  type FileEntry,
  FormField,
  Input,
} from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { chmodFile } from "@/server/api/files";

const CLASSES = ["owner", "group", "others"] as const;
const DROITS = ["read", "write", "execute"] as const;

/**
 * Permissions d'une entrée : saisie octale et cases, deux vues d'un même état.
 *
 * Le mode tapé est la seule source de vérité ; les cases le lisent et
 * l'écrivent. Deux états tenus séparément finiraient par se contredire au
 * premier chiffre invalide — et l'on ne saurait plus lequel serait appliqué.
 *
 * Le mode actuel vient du listage (`-rw-r--r--`), relu par la même règle que
 * celle qui valide côté API : l'écran ne propose jamais un mode que l'API
 * refuserait.
 */
export function FilesPermissionsDialog({
  serverId,
  path,
  entry,
  onClose,
  onChanged,
}: {
  serverId: string;
  path: string;
  entry: FileEntry | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("fileTools");
  const tc = useTranslations("common");
  const actuel = entry ? octalFromSymbolic(entry.mode) : null;
  const [mode, setMode] = useState("");
  const [refus, setRefus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Repart du mode de l'entrée à chaque ouverture : une saisie abandonnée sur
  // un fichier ne doit pas se retrouver proposée pour le suivant.
  useEffect(() => {
    setMode(entry ? (octalFromSymbolic(entry.mode) ?? "") : "");
    setRefus(null);
  }, [entry]);

  if (!entry) return null;
  const valide = FileMode.safeParse(mode).success;
  const bits = valide ? modeToBits(mode) : null;

  const basculer = (who: keyof ModeBits, droit: (typeof DROITS)[number], coche: boolean) => {
    if (!bits) return;
    setMode(bitsToMode({ ...bits, [who]: { ...bits[who], [droit]: coche } }));
  };

  const appliquer = () =>
    startTransition(async () => {
      const { error } = await chmodFile(serverId, path, entry.name, mode);
      if (error) setRefus(error);
      else {
        onClose();
        await onChanged();
      }
    });

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent
        title={t("permissionsTitle", { name: entry.name })}
        description={
          actuel
            ? t("permissionsCurrent", { mode: `${actuel} (${entry.mode})` })
            : t("permissionsUnknown")
        }
        closeLabel={tc("close")}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={!valide || mode === actuel || pending}
              loading={pending}
              onClick={appliquer}
            >
              {t("apply")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {refus ? (
            <AlertBanner variant="danger" title={tc("refused")}>
              {refus}
            </AlertBanner>
          ) : null}
          <FormField
            label={t("permissionsOctal")}
            description={t("permissionsOctalHint")}
            error={mode !== "" && !valide ? t("permissionsInvalid") : undefined}
          >
            {(id) => (
              <Input
                id={id}
                value={mode}
                inputMode="numeric"
                maxLength={3}
                className="font-mono sm:max-w-32"
                onChange={(e) => setMode(e.target.value.trim())}
              />
            )}
          </FormField>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted text-xs">
                <th className="py-1 font-semibold" />
                {DROITS.map((droit) => (
                  <th key={droit} className="py-1 font-semibold">
                    {t(droit)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CLASSES.map((who) => (
                <tr key={who} className="border-border border-t">
                  <th scope="row" className="py-2 text-left font-medium text-fg">
                    {t(who)}
                  </th>
                  {DROITS.map((droit) => (
                    <td key={droit} className="py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-accent"
                        aria-label={`${t(who)} — ${t(droit)}`}
                        disabled={!bits}
                        checked={bits?.[who][droit] ?? false}
                        onChange={(e) => basculer(who, droit, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {entry.isDirectory ? (
            <p className="text-muted text-xs">{t("permissionsDirectoryHint")}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
