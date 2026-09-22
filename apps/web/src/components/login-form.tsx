"use client";

import { AlertBanner, Button, FormField, Input, OrDivider, PasswordInput } from "@gamedashboard/ui";
import { startAuthentication } from "@simplewebauthn/browser";
import { ArrowRight, Fingerprint, KeyRound, Lock, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { CaptchaField } from "@/components/captcha-field";
import { INITIAL_LOGIN_STATE, type LoginState } from "@/lib/login-state";
import { login, passkeyLoginOptions, submitPasskey, submitSecondFactor } from "@/server/api/login";

/**
 * Formulaire de connexion.
 *
 * Le mot de passe ne quitte pas le serveur : le formulaire est soumis à une
 * action serveur, qui appelle l'API. Le composant client ne voit ni l'adresse
 * de l'API ni le cookie de session.
 *
 * `resumed` reprend une cérémonie externe déjà passée, en attente du seul
 * second facteur : l'écran saute alors directement à la seconde étape.
 */
export function LoginForm({
  resumed = null,
  captchaSiteKey = null,
  passwordResetByEmail = false,
}: {
  resumed?: LoginState | null;
  /** Clé de site Turnstile, ou `null` quand la plateforme n'exige rien. */
  captchaSiteKey?: string | null;
  /** Faux quand la plateforme n'a pas de SMTP : le lien ne mènerait à rien. */
  passwordResetByEmail?: boolean;
}) {
  const [state, formAction, pending] = useActionState(login, resumed ?? INITIAL_LOGIN_STATE);

  // Tant qu'aucun défi n'est revenu, le compte n'exige pas de second facteur —
  // ou le mot de passe n'a pas encore été accepté.
  return state.challenge ? (
    <SecondFactorStep state={state} />
  ) : (
    <CredentialsStep
      state={state}
      formAction={formAction}
      pending={pending}
      captchaSiteKey={captchaSiteKey}
      passwordResetByEmail={passwordResetByEmail}
    />
  );
}

function CredentialsStep({
  state,
  formAction,
  pending,
  captchaSiteKey,
  passwordResetByEmail,
}: {
  state: LoginState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  captchaSiteKey: string | null;
  passwordResetByEmail: boolean;
}) {
  const t = useTranslations("login");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <AlertBanner variant="danger" title={t("refused")}>
          {state.error}
        </AlertBanner>
      ) : null}

      <FormField label={t("email")}>
        {(id) => (
          <Input
            id={id}
            name="email"
            type="email"
            inputSize="lg"
            placeholder="vous@exemple.fr"
            leadingIcon={<Mail />}
            autoComplete="email"
            required
          />
        )}
      </FormField>

      <FormField label={t("password")}>
        {(id) => (
          <PasswordInput
            id={id}
            name="password"
            inputSize="lg"
            placeholder="••••••••••"
            leadingIcon={<Lock />}
            autoComplete="current-password"
            required
          />
        )}
      </FormField>

      {/*
        Le libellé existait depuis le début sans destination ; il mène
        maintenant quelque part — mais seulement là où il mène vraiment.
        Sans SMTP, ce lien ouvre un formulaire qui remercie et n'envoie rien.
      */}
      {passwordResetByEmail ? (
        <Link
          href="/forgot"
          className="-mt-2 self-end text-muted text-xs hover:text-accent hover:underline"
        >
          {t("forgotPassword")}
        </Link>
      ) : null}

      <CaptchaField siteKey={captchaSiteKey} />

      <Button size="lg" fullWidth type="submit" loading={pending}>
        {t("submit")} <ArrowRight />
      </Button>
    </form>
  );
}

/**
 * Seconde étape : le code de l'application, ou un code de secours.
 *
 * Le code de secours est derrière un lien plutôt qu'affiché d'emblée : il ne
 * sert qu'une fois, et le proposer à égalité inviterait à épuiser le carnet
 * plutôt qu'à sortir son téléphone.
 */
function SecondFactorStep({ state }: { state: LoginState }) {
  const t = useTranslations("login");
  const [current, action, pending] = useActionState(submitSecondFactor, state);
  const [useRecovery, setUseRecovery] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  /**
   * Cérémonie WebAuthn.
   *
   * Trois temps : demander les options au serveur, laisser le navigateur faire
   * signer l'authentifiant, renvoyer l'assertion. Le défi scellé change entre
   * le premier et le troisième — celui de la connexion ne porte pas le défi
   * aléatoire, et l'un ne doit pas valoir pour l'autre.
   */
  const useKey = async () => {
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      const options = await passkeyLoginOptions(state.challenge ?? "");
      if (options.error || !options.options) {
        setPasskeyError(options.error ?? t("passkeyFailed"));
        return;
      }

      const assertion = await startAuthentication({
        optionsJSON: options.options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      });
      const result = await submitPasskey(options.challenge, assertion);
      // `submitPasskey` redirige en cas de succès : on n'arrive ici qu'en cas
      // de refus, ou si la personne a fermé la fenêtre du navigateur.
      if (result?.error) setPasskeyError(result.error);
    } catch {
      // Cérémonie abandonnée, clé absente, navigateur qui refuse : rien de tout
      // cela ne mérite une trace, et l'autre méthode reste offerte juste en
      // dessous.
      setPasskeyError(t("passkeyFailed"));
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="challenge" value={state.challenge ?? ""} />

      {current.error || passkeyError ? (
        <AlertBanner variant="danger" title={t("refused")}>
          {current.error ?? passkeyError}
        </AlertBanner>
      ) : null}

      {/* La clé d'accès passe devant : elle ne demande rien à recopier. Elle
          n'apparaît que si le compte en a réellement une — sinon la boîte de
          dialogue du navigateur s'ouvrirait pour échouer. */}
      {state.methods.passkeys && !useRecovery ? (
        <>
          <Button
            type="button"
            size="lg"
            fullWidth
            variant="secondary"
            loading={passkeyBusy}
            onClick={useKey}
          >
            <Fingerprint /> {t("usePasskey")}
          </Button>
          {state.methods.totp ? <OrDivider>{t("orWithCode")}</OrDivider> : null}
        </>
      ) : null}

      {/* Prévenir pendant qu'il est encore temps d'en régénérer : découvrir un
          carnet vide le jour où le téléphone est perdu est trop tard. */}
      {!useRecovery && state.remainingRecoveryCodes === 0 ? (
        <AlertBanner variant="warning">{t("noRecoveryCodesLeft")}</AlertBanner>
      ) : null}

      {useRecovery ? (
        <FormField label={t("recoveryCode")} description={t("recoveryCodeHint")}>
          {(id) => (
            <Input
              id={id}
              name="recoveryCode"
              inputSize="lg"
              className="gd-mono"
              placeholder="XXXXX-XXXXX"
              leadingIcon={<KeyRound />}
              autoComplete="one-time-code"
              autoFocus
              required
            />
          )}
        </FormField>
      ) : state.methods.totp ? (
        <FormField label={t("totpCode")} description={t("totpCodeHint")}>
          {(id) => (
            <Input
              id={id}
              name="code"
              inputSize="lg"
              className="gd-mono tracking-[0.3em]"
              placeholder="000000"
              leadingIcon={<ShieldCheck />}
              inputMode="numeric"
              // `one-time-code` laisse le téléphone proposer le code reçu ou
              // celui de son gestionnaire de mots de passe.
              autoComplete="one-time-code"
              autoFocus
              required
            />
          )}
        </FormField>
      ) : null}

      {/* Le bouton d'envoi ne sert qu'à un champ saisi. Un compte protégé par
          la seule clé d'accès n'en a aucun : l'afficher quand même ferait
          cliquer dans le vide. */}
      {useRecovery || state.methods.totp ? (
        <Button size="lg" fullWidth type="submit" loading={pending}>
          {t("verify")} <ArrowRight />
        </Button>
      ) : null}

      <button
        type="button"
        onClick={() => setUseRecovery((v) => !v)}
        className="cursor-pointer text-center text-sm font-semibold text-accent hover:underline"
      >
        {useRecovery
          ? state.methods.totp
            ? t("useTotpInstead")
            : t("usePasskeyInstead")
          : t("useRecoveryInstead")}
      </button>
    </form>
  );
}
