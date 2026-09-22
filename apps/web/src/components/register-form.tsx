"use client";

import { AlertBanner, Button, FormField, Input, PasswordInput } from "@gamedashboard/ui";
import { ArrowRight, Lock, Mail, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { CaptchaField } from "@/components/captcha-field";
import { register } from "@/server/api/register";

/**
 * Inscription publique.
 *
 * La politique de mot de passe n'est **pas** recopiée ici : l'API la tient, et
 * son refus arrive en toutes lettres avec le détail des manquements. Une
 * vérification locale rassurerait à tort le jour où la règle change d'un seul
 * côté — et le formulaire peut de toute façon être contourné, la route non.
 */
export function RegisterForm({ captchaSiteKey = null }: { captchaSiteKey?: string | null }) {
  const t = useTranslations("register");
  const tl = useTranslations("login");
  const [state, formAction, pending] = useActionState(register, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <AlertBanner variant="danger" title={tl("refused")}>
          {state.error}
        </AlertBanner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("firstName")}>
          {(id) => (
            <Input id={id} name="nameFirst" inputSize="lg" leadingIcon={<User />} required />
          )}
        </FormField>
        <FormField label={t("lastName")}>
          {(id) => <Input id={id} name="nameLast" inputSize="lg" required />}
        </FormField>
      </div>

      <FormField label={tl("email")}>
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

      <FormField label={tl("password")} description={t("passwordHint")}>
        {(id) => (
          <PasswordInput
            id={id}
            name="password"
            inputSize="lg"
            placeholder="••••••••••"
            leadingIcon={<Lock />}
            autoComplete="new-password"
            required
          />
        )}
      </FormField>

      <CaptchaField siteKey={captchaSiteKey} />

      <Button size="lg" fullWidth type="submit" loading={pending}>
        {t("submit")} <ArrowRight />
      </Button>
    </form>
  );
}
