"use client";

import { type RenameRefusal, renameRefusal } from "@gamedashboard/contracts";
import { Button, Dialog, DialogContent, type FileEntry, FormField, Input } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { renameFile } from "@/server/api/files";

/**
 * Renommer, ou déplacer par un chemin relatif.
 *
 * Un seul champ pour les deux gestes, parce que le daemon n'en connaît qu'un :
 * `plugins/a.jar` déplace, `b.jar` renomme, `../a.jar` remonte d'un dossier.
 * Deux écrans auraient laissé croire à deux opérations distinctes.
 *
 * Les refus évidents sont dits ici, avant tout appel, par la même règle que
 * l'API applique (`renameRefusal`). La collision, elle, ne se voit que chez le
 * daemon : elle revient en 409, et la fenêtre reste ouverte pour qu'on
 * choisisse un autre nom sans tout retaper.
 */
export function FilesRenameDialog({
  serverId,
  path,
  entry,
  onClose,
  onRenamed,
}: {
  serverId: string;
  path: string;
  entry: FileEntry | null;
  onClose: () => void;
  onRenamed: () => Promise<void>;
}) {
  const t = useTranslations("fileTools");
  const tc = useTranslations("common");
  const [cible, setCible] = useState("");
  const [refus, setRefus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setCible(entry?.name ?? "");
    setRefus(null);
  }, [entry]);

  if (!entry) return null;
  const local = renameRefusal(entry.name, cible);
  const messages: Record<RenameRefusal, string> = {
    empty: t("renameEmpty"),
    trailingSlash: t("renameTrailingSlash", { example: `${cible.trim()}${entry.name}` }),
    unchanged: t("renameUnchanged"),
  };
  // « Inchangé » n'est pas une faute à signaler en rouge dès l'ouverture : le
  // champ part du nom actuel, et c'est le bouton qui reste simplement éteint.
  const erreur = refus ?? (local && local !== "unchanged" ? messages[local] : undefined);

  const valider = () =>
    startTransition(async () => {
      const resultat = await renameFile(serverId, path, entry.name, cible.trim());
      if (resultat.conflict) setRefus(t("renameConflict", { name: cible.trim() }));
      else if (resultat.error) setRefus(resultat.error);
      else {
        onClose();
        await onRenamed();
      }
    });

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent
        title={t("renameTitle", { name: entry.name })}
        closeLabel={tc("close")}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button disabled={local !== null || pending} loading={pending} onClick={valider}>
              {tc("save")}
            </Button>
          </>
        }
      >
        <FormField
          label={t("renameLabel")}
          description={t("renameHint", { path, name: entry.name })}
          error={erreur}
        >
          {(id) => (
            <Input
              id={id}
              value={cible}
              autoFocus
              onChange={(e) => {
                setCible(e.target.value);
                setRefus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && local === null && !pending) valider();
              }}
            />
          )}
        </FormField>
      </DialogContent>
    </Dialog>
  );
}
