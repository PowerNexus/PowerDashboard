"use client";

import {
  AlertBanner,
  Button,
  Dialog,
  DialogContent,
  FormField,
  Input,
  PasswordInput,
  RelativeTime,
} from "@gamedashboard/ui";
import { Lock, Plus, TerminalSquare, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { addSshKey, removeSshKey, type SshKey } from "@/server/api/ssh-keys";

/**
 * Clés publiques SSH du compte, pour le SFTP.
 *
 * Elles n'ouvrent aucun accès nouveau : une clé enregistrée ici ne donne que
 * les fichiers des serveurs auxquels le compte a déjà droit. C'est un moyen
 * d'entrée de plus sur le même accès — et le bon, puisqu'un mot de passe de
 * SFTP se confie à un client tiers, alors qu'une clé ne quitte pas la machine
 * de son porteur.
 */
export function SshKeyList({
  initial,
  localPassword,
}: {
  initial: SshKey[];
  /** Le compte a un mot de passe à redonner avant d'ajouter une clé. */
  localPassword: boolean;
}) {
  const t = useTranslations("security");
  const tc = useTranslations("common");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await addSshKey(name, publicKey, password);
      setError(result.error);
      if (result.error) return;

      setAdding(false);
      setName("");
      setPublicKey("");
      setPassword("");
      router.refresh();
    });

  /**
   * La suppression ne demande pas confirmation, et c'est délibéré.
   *
   * Retirer une clé ne détruit rien : le compte garde ses serveurs, ses
   * fichiers et son mot de passe, et la clé se recolle en dix secondes. Une
   * boîte de dialogue ici ferait perdre son sens à celles qui protègent des
   * gestes irréversibles.
   */
  const remove = (keyId: string) =>
    startTransition(async () => {
      const result = await removeSshKey(keyId);
      setError(result.error);
      if (!result.error) router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 border-border border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex size-10 items-center justify-center rounded-full [&_svg]:size-5 ${
              initial.length > 0 ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
            }`}
          >
            <TerminalSquare />
          </span>
          <div>
            <p className="font-semibold text-fg text-sm">{t("sshKeysTitle")}</p>
            <p className="text-muted text-xs">{t("sshKeysHint")}</p>
          </div>
        </div>
        <Button variant="secondary" disabled={pending} onClick={() => setAdding(true)}>
          <Plus /> {t("sshKeyAdd")}
        </Button>
      </div>

      {error && !adding ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {initial.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
          {initial.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{key.name}</p>
                {/* L'empreinte est celle qu'affiche `ssh-keygen -lf` : c'est la
                    seule chose qu'on peut comparer avec sa propre machine. */}
                <p className="gd-mono truncate text-faint text-xs">{key.fingerprint}</p>
                <p className="text-muted text-xs">
                  {/* « Jamais employée » plutôt qu'une date de repli : une clé
                      enregistrée et jamais servie est précisément ce qu'on
                      cherche à repérer pour la retirer. */}
                  {key.lastUsedAt ? (
                    <>
                      {t("sshKeyLastUsed")} <RelativeTime value={key.lastUsedAt} />
                    </>
                  ) : (
                    t("sshKeyNeverUsed")
                  )}
                </p>
              </div>
              <span className="gd-mono text-faint text-xs">{key.algorithm}</span>
              <Button
                variant="danger-ghost"
                size="sm"
                disabled={pending}
                onClick={() => remove(key.id)}
              >
                <Trash2 /> {tc("delete")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <DialogContent
          title={t("sshKeyAdd")}
          description={t("sshKeyAddHint")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                {tc("cancel")}
              </Button>
              <Button
                loading={pending}
                disabled={localPassword && password === ""}
                onClick={submit}
              >
                {tc("save")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {error ? (
              <AlertBanner variant="danger" title={tc("actionRefused")}>
                {error}
              </AlertBanner>
            ) : null}

            <FormField label={t("sshKeyName")} description={t("sshKeyNameHint")}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  placeholder={t("sshKeyNamePlaceholder")}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </FormField>

            <FormField label={t("sshKeyPublic")} description={t("sshKeyPublicHint")}>
              {(id) => (
                <textarea
                  id={id}
                  value={publicKey}
                  rows={4}
                  spellCheck={false}
                  placeholder="ssh-ed25519 AAAAC3Nza… vous@machine"
                  onChange={(event) => setPublicKey(event.target.value)}
                  className="gd-mono w-full resize-y rounded-field border border-border bg-surface px-3 py-2 text-fg text-xs outline-none focus:border-accent"
                />
              )}
            </FormField>

            {/* Dit une fois, à l'endroit où l'erreur se commet : c'est le
                fichier « .pub » qu'on colle, jamais la clé privée. */}
            <AlertBanner variant="info">{t("sshKeyPrivateWarning")}</AlertBanner>

            {/* Une clé ouvre les fichiers de tous les serveurs du compte et
                survit à la session : elle ne se pose que contre le mot de passe. */}
            {localPassword ? (
              <FormField label={t("confirmPassword")} description={t("confirmPasswordHint")}>
                {(id) => (
                  <PasswordInput
                    id={id}
                    leadingIcon={<Lock />}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
              </FormField>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
