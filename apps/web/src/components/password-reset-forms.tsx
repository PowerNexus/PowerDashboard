"use client";

import { AlertBanner, Button, FormField, Input } from "@gamedashboard/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { CaptchaField } from "@/components/captcha-field";
import { requestPasswordReset, submitPasswordReset } from "@/server/api/password-reset";

/**
 * Demande de lien.
 *
 * **Le message de confirmation est le même dans tous les cas**, y compris quand
 * l'adresse est inconnue. Ce n'est pas une imprécision : dire « ce compte
 * n'existe pas » ferait de ce formulaire un moyen de savoir qui est client.
 * L'écran annonce donc ce qui est vrai — si un compte porte cette adresse, un
 * courriel part.
 */
export function ForgotPasswordForm({ captchaSiteKey = null }: { captchaSiteKey?: string | null }) {
  const t = useTranslations("passwordReset");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <AlertBanner variant="success" title={t("sentTitle")}>
        {t("sentBody")}
      </AlertBanner>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        /*
         * Le jeton est lu **avant** la transition, et c'est obligatoire.
         *
         * React vide `currentTarget` dès que le gestionnaire rend la main : le
         * lire dans le corps asynchrone donnerait `null`, et le captcha serait
         * refusé sur un formulaire pourtant rempli.
         *
         * Il est lu dans le formulaire plutôt que tenu en état parce que c'est
         * Turnstile qui écrit le champ caché ; le recopier ailleurs ferait deux
         * vérités pour une même valeur.
         */
        const token = String(new FormData(event.currentTarget).get("captchaToken") ?? "");

        startTransition(async () => {
          const result = await requestPasswordReset(email.trim(), token);
          setError(result.error);
          // L'écran ne bascule que si la demande est **partie**. Une panne
          // réseau qui afficherait « courriel envoyé » ferait attendre en vain.
          if (!result.error) setSent(true);
        });
      }}
    >
      {error ? (
        <AlertBanner variant="danger" title={t("failedTitle")}>
          {error}
        </AlertBanner>
      ) : null}

      <FormField label={t("emailLabel")} description={t("emailHint")}>
        {(id) => (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </FormField>

      <CaptchaField siteKey={captchaSiteKey} />

      <Button type="submit" size="lg" fullWidth disabled={pending || email.trim() === ""}>
        {t("sendLink")}
      </Button>
    </form>
  );
}

/**
 * Choix du nouveau mot de passe.
 *
 * La politique n'est **pas** recopiée ici : l'API la tient, et son refus arrive
 * en toutes lettres. Une vérification locale rassurerait à tort le jour où la
 * règle change d'un côté seulement.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("passwordReset");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Seul contrôle local : les deux saisies concordent. Il ne double aucune
  // règle de l'API, il rattrape une faute de frappe sur un champ masqué.
  const mismatch = confirmation !== "" && confirmation !== password;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await submitPasswordReset(token, password);
          setError(result.error);
          // Toutes les sessions sont tombées avec l'ancien mot de passe : il
          // faut se reconnecter, et l'écran de connexion est le bon endroit.
          if (!result.error) router.push("/login?reset=1");
        });
      }}
    >
      {error ? (
        <AlertBanner variant="danger" title={t("failedTitle")}>
          {error}
        </AlertBanner>
      ) : null}

      <FormField label={t("newPassword")}>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </FormField>

      <FormField label={t("confirmPassword")}>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        )}
      </FormField>

      {mismatch ? (
        <AlertBanner variant="warning" title={t("mismatchTitle")}>
          {t("mismatchBody")}
        </AlertBanner>
      ) : null}

      <Button
        type="submit"
        size="lg"
        fullWidth
        disabled={pending || password === "" || mismatch || confirmation === ""}
      >
        {t("change")}
      </Button>
    </form>
  );
}
