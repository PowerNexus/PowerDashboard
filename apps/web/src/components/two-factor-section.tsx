"use client";

import {
  AlertBanner,
  Badge,
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  FormField,
  Input,
  PasswordInput,
  RelativeTime,
  SettingsSection,
} from "@gamedashboard/ui";
import { Lock, ShieldCheck, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { PasskeyList } from "@/components/passkey-list";
import type { Passkey } from "@/server/api/passkeys";
import {
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  resetRecoveryCodes,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from "@/server/api/two-factor";

/**
 * Double authentification.
 *
 * Un seul état fait foi : celui que rend l'API. L'écran ne mémorise jamais
 * « c'est activé » de son côté — sur cette page, afficher une protection qui
 * n'existe pas est pire que de n'afficher rien du tout.
 */
export function TwoFactorSection({
  initial,
  passkeys,
}: {
  initial: TwoFactorStatus;
  passkeys: Passkey[];
}) {
  const t = useTranslations("security");
  const tc = useTranslations("common");
  const router = useRouter();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState<"enable" | "disable" | "regenerate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setSetup(null);
    setConfirming(null);
    setCode("");
    setPassword("");
    setError(null);
  };

  /**
   * Préparation du secret, contre le mot de passe du compte.
   *
   * Demandé avant le QR code et non après : sans lui, une session volée
   * enrôlait son propre TOTP. Un compte sans mot de passe local passe
   * directement, l'API ne lui redemande rien.
   */
  const begin = (secret: string) =>
    startTransition(async () => {
      const result = await beginTwoFactorSetup(secret);
      setError(result.error);
      if (!result.setup) return;
      setConfirming(null);
      setPassword("");
      setSetup(result.setup);
    });

  /** Les trois gestes confirmés par le mot de passe, et ce que chacun affiche. */
  const confirmations = {
    enable: {
      title: t("setupTitle"),
      description: t("enableConfirmBody"),
      label: t("enable"),
      variant: "primary",
      run: () => begin(password),
    },
    disable: {
      title: t("disableTitle"),
      description: t("disableBody"),
      label: t("disable"),
      variant: "danger",
      run: () => disable(),
    },
    regenerate: {
      title: t("recoveryRegenerate"),
      description: t("recoveryRegenerateHint"),
      label: t("recoveryRegenerate"),
      variant: "primary",
      run: () => regenerate(),
    },
  } as const;
  const confirmation = confirming ? confirmations[confirming] : null;

  const confirm = () =>
    startTransition(async () => {
      const result = await enableTwoFactor(code);
      setError(result.error);
      if (result.recoveryCodes) {
        setSetup(null);
        setCode("");
        setRecoveryCodes(result.recoveryCodes);
        router.refresh();
      }
    });

  const regenerate = () =>
    startTransition(async () => {
      const result = await resetRecoveryCodes(password);
      setError(result.error);
      if (result.recoveryCodes) {
        setConfirming(null);
        setPassword("");
        setRecoveryCodes(result.recoveryCodes);
        router.refresh();
      }
    });

  const disable = () =>
    startTransition(async () => {
      const result = await disableTwoFactor(password);
      setError(result.error);
      if (!result.error) {
        close();
        router.refresh();
      }
    });

  return (
    <SettingsSection title={t("twoFactor")} description={t("twoFactorHint")}>
      <div className="flex flex-col gap-4">
        {error && !setup && !confirming ? (
          <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
            {error}
          </AlertBanner>
        ) : null}

        {/* Codes à usage unique : la partie réellement servie. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex size-10 items-center justify-center rounded-full [&_svg]:size-5 ${
                initial.totp ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
              }`}
            >
              <Smartphone />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                {t("twoFactorApp")}
                <Badge variant={initial.totp ? "success" : "neutral"}>
                  {initial.totp ? t("twoFactorActive") : t("twoFactorInactive")}
                </Badge>
              </p>
              <p className="text-xs text-muted">
                {initial.totp && initial.enabledAt ? (
                  <>
                    {t("twoFactorOnSince")} <RelativeTime value={initial.enabledAt} />
                  </>
                ) : (
                  t("twoFactorOffHint")
                )}
              </p>
            </div>
          </div>
          {initial.totp ? (
            <Button
              variant="danger-ghost"
              disabled={pending}
              onClick={() => setConfirming("disable")}
            >
              {t("disable")}
            </Button>
          ) : (
            <Button
              disabled={pending}
              onClick={() => (initial.localPassword ? setConfirming("enable") : begin(""))}
            >
              <ShieldCheck /> {t("enable")}
            </Button>
          )}
        </div>

        {/* Codes de secours : seulement une fois la protection en place, car
            sans elle ils ne protègent de rien. */}
        {initial.enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <p className="text-sm font-semibold text-fg">
                {t("recoveryTitle")}{" "}
                <Badge variant={initial.remainingRecoveryCodes === 0 ? "danger" : "neutral"}>
                  {t("recoveryRemaining", { count: initial.remainingRecoveryCodes })}
                </Badge>
              </p>
              <p className="text-xs text-muted">
                {initial.remainingRecoveryCodes === 0
                  ? t("recoveryNone")
                  : t("recoveryRegenerateHint")}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirming("regenerate")}
            >
              {t("recoveryRegenerate")}
            </Button>
          </div>
        ) : null}

        <PasskeyList
          initial={passkeys}
          localPassword={initial.localPassword}
          onRecoveryCodes={setRecoveryCodes}
        />
      </div>

      {/* --- Activation --- */}
      <Dialog open={setup !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent
          title={t("setupTitle")}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {tc("cancel")}
              </Button>
              <Button disabled={code.trim().length < 6 || pending} onClick={confirm}>
                {t("confirm")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            {error ? (
              <AlertBanner variant="danger" title={tc("actionRefused")}>
                {error}
              </AlertBanner>
            ) : null}

            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-fg">{t("setupStep1")}</p>
              <p className="text-xs text-muted">{t("setupStep1Hint")}</p>
              {setup ? (
                <div className="flex justify-center rounded-card bg-white p-4">
                  {/* biome-ignore lint/performance/noImgElement: data URI local, sans optimisation à faire */}
                  <img src={setup.qrSvg} alt="" width={192} height={192} />
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted">{t("setupManual")}</p>
                {setup ? <CopyButton value={setup.secret} label={tc("copy")} /> : null}
              </div>
              <code className="gd-mono break-all rounded-field bg-surface-2 px-3 py-2 text-center text-sm text-fg">
                {setup?.secret}
              </code>
            </div>

            <FormField label={t("setupStep2")} description={t("setupStep2Hint")}>
              {(id) => (
                <Input
                  id={id}
                  className="gd-mono tracking-[0.3em]"
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </FormField>
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Codes de secours, montrés une seule fois --- */}
      <Dialog
        open={recoveryCodes !== null}
        onOpenChange={(open) => !open && setRecoveryCodes(null)}
      >
        <DialogContent
          title={t("recoveryTitle")}
          description={t("recoveryHint")}
          footer={
            <>
              {recoveryCodes ? (
                <CopyButton value={recoveryCodes.join("\n")} label={t("recoveryCopy")} />
              ) : null}
              <Button onClick={() => setRecoveryCodes(null)}>{t("recoveryDone")}</Button>
            </>
          }
        >
          <ul className="grid grid-cols-2 gap-2">
            {recoveryCodes?.map((recoveryCode) => (
              <li
                key={recoveryCode}
                className="gd-mono rounded-field bg-surface-2 px-3 py-2 text-center text-sm text-fg"
              >
                {recoveryCode}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {/* --- Confirmation par mot de passe --- */}
      <Dialog open={confirmation !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent
          title={confirmation?.title}
          description={confirmation?.description}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {tc("cancel")}
              </Button>
              <Button
                variant={confirmation?.variant}
                disabled={password === "" || pending}
                onClick={confirmation?.run}
              >
                {confirmation?.label}
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
    </SettingsSection>
  );
}
