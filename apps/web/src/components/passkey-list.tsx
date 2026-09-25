"use client";

import {
  AlertBanner,
  Badge,
  Button,
  Dialog,
  DialogContent,
  FormField,
  Input,
  PasswordInput,
  RelativeTime,
} from "@gamedashboard/ui";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  type Passkey,
  passkeyRegistrationOptions,
  registerPasskey,
  removePasskey,
} from "@/server/api/passkeys";

/**
 * Clés d'accès du compte.
 *
 * Les cérémonies WebAuthn ne peuvent se dérouler que dans le navigateur : le
 * serveur prépare et vérifie, l'authentifiant signe, et ce composant ne fait
 * que les mettre en relation. Rien de ce qui transite ici n'est cru sur parole
 * — la signature est vérifiée côté API contre l'origine configurée.
 */
export function PasskeyList({
  initial,
  localPassword,
  onRecoveryCodes,
}: {
  initial: Passkey[];
  /** Le compte a un mot de passe à redonner avant d'enregistrer une clé. */
  localPassword: boolean;
  /** Appelé quand l'enregistrement a créé le premier lot de codes de secours. */
  onRecoveryCodes: (codes: string[]) => void;
}) {
  const t = useTranslations("security");
  const tc = useTranslations("common");
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [toRemove, setToRemove] = useState<Passkey | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  /**
   * Enregistrement : options, signature, vérification.
   *
   * Le nom est demandé **avant** la cérémonie : après, la boîte de dialogue du
   * navigateur a déjà disparu et on ne se souvient plus de quelle clé on vient
   * de toucher. Le mot de passe aussi, pour la même raison : c'est le seul
   * moment où l'écran a encore la main.
   */
  const enroll = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await passkeyRegistrationOptions(password);
      if (options.error || !options.options) {
        setError(options.error ?? t("passkeyFailed"));
        return;
      }

      const response = await startRegistration({
        optionsJSON: options.options as Parameters<typeof startRegistration>[0]["optionsJSON"],
      });
      const result = await registerPasskey(options.challenge, label.trim(), response);
      if (result.error) {
        setError(result.error);
        return;
      }

      setAdding(false);
      setLabel("");
      setPassword("");
      if (result.recoveryCodes) onRecoveryCodes(result.recoveryCodes);
      router.refresh();
    } catch {
      // Cérémonie abandonnée, clé déjà enregistrée, navigateur sans WebAuthn :
      // aucun de ces cas ne distingue utilement un message de l'autre.
      setError(t("passkeyFailed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ouvre l'une des deux boîtes, champ du mot de passe vidé : il est partagé
   * entre l'ajout et le retrait, et celui tapé pour l'un ne doit pas
   * réapparaître, déjà rempli, dans l'autre.
   */
  const open = (show: () => void) => {
    setPassword("");
    setError(null);
    show();
  };

  const remove = () =>
    startTransition(async () => {
      const target = toRemove;
      if (!target) return;
      const result = await removePasskey(target.id, password);
      setError(result.error);
      if (!result.error) {
        setToRemove(null);
        setPassword("");
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex size-10 items-center justify-center rounded-full [&_svg]:size-5 ${
              initial.length > 0 ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
            }`}
          >
            <Fingerprint />
          </span>
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-fg">
              {t("passkeysTitle")}
              <Badge variant={initial.length > 0 ? "success" : "neutral"}>
                {initial.length > 0 ? t("twoFactorActive") : t("twoFactorInactive")}
              </Badge>
            </p>
            <p className="text-xs text-muted">{t("passkeysHint")}</p>
          </div>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => open(() => setAdding(true))}>
          <Plus /> {t("passkeyAdd")}
        </Button>
      </div>

      {error && !adding && !toRemove ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {initial.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
          {initial.map((passkey) => (
            <li key={passkey.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{passkey.label}</p>
                {/* Une clé est liée au domaine où elle a été créée : le dire
                    évite de chercher pourquoi elle n'est pas proposée ailleurs. */}
                {passkey.domain ? (
                  <p className="text-xs text-muted">
                    {t("passkeyDomain", { domain: passkey.domain })}
                  </p>
                ) : null}
                <p className="text-xs text-muted">
                  {/* « Jamais » plutôt qu'une date de repli : une clé enregistrée
                      et jamais employée est précisément ce qu'on cherche à voir. */}
                  {passkey.lastUsedAt ? (
                    <>
                      {t("passkeyLastUsed")} <RelativeTime value={passkey.lastUsedAt} />
                    </>
                  ) : (
                    t("passkeyNeverUsed")
                  )}
                </p>
              </div>
              {passkey.transports.length > 0 ? (
                <span className="gd-mono text-xs text-faint">{passkey.transports.join(" · ")}</span>
              ) : null}
              <Button
                variant="danger-ghost"
                size="sm"
                disabled={pending}
                onClick={() => open(() => setToRemove(passkey))}
              >
                <Trash2 /> {tc("delete")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <DialogContent
          title={t("passkeyAdd")}
          description={t("passkeyAddHint")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                {tc("cancel")}
              </Button>
              <Button loading={busy} disabled={localPassword && password === ""} onClick={enroll}>
                {t("passkeyContinue")}
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
            <FormField label={t("passkeyLabel")} description={t("passkeyLabelHint")}>
              {(id) => (
                <Input
                  id={id}
                  value={label}
                  placeholder={t("passkeyLabelPlaceholder")}
                  onChange={(e) => setLabel(e.target.value)}
                />
              )}
            </FormField>
            {localPassword ? (
              <FormField label={t("confirmPassword")} description={t("confirmPasswordHint")}>
                {(id) => (
                  <PasswordInput
                    id={id}
                    leadingIcon={<Lock />}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </FormField>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <DialogContent
          title={t("passkeyRemoveTitle")}
          description={t("passkeyRemoveBody", { label: toRemove?.label ?? "" })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setToRemove(null)}>
                {tc("cancel")}
              </Button>
              <Button variant="danger" disabled={password === "" || pending} onClick={remove}>
                {tc("delete")}
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
            <FormField label={t("confirmPassword")} description={t("confirmPasswordHint")}>
              {(id) => (
                <PasswordInput
                  id={id}
                  leadingIcon={<Lock />}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </FormField>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
