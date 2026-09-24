"use client";

import { identityFragments } from "@gamedashboard/contracts";
import { AlertBanner, Button, FormField, Input, PasswordInput } from "@gamedashboard/ui";
import { ArrowRight, Lock, Mail, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { CaptchaField } from "@/components/captcha-field";
import { NewPasswordStrength } from "@/components/new-password-strength";
import { register } from "@/server/api/register";

/**
 * Inscription publique.
 *
 * La politique de mot de passe n'est **pas** recopiée ici : l'API la tient, et
 * son refus arrive en toutes lettres avec le détail des manquements. La jauge
 * sous le champ applique la même règle, tirée des contrats partagés — une
 * copie locale rassurerait à tort le jour où la règle change d'un seul côté —
 * et le formulaire peut de toute façon être contourné, la route non.
 *
 * Les champs restent ceux du formulaire, envoyés par leur `name` ; l'écran
 * n'en suit la valeur que pour la jauge, qui refuse comme l'API un mot de
 * passe contenant le nom ou l'adresse.
 */
export function RegisterForm({ captchaSiteKey = null }: { captchaSiteKey?: string | null }) {
  const t = useTranslations("register");
  const tl = useTranslations("login");
  const [state, formAction, pending] = useActionState(register, { error: null });
  const [identity, setIdentity] = useState({ email: "", nameFirst: "", nameLast: "" });
  const [password, setPassword] = useState("");
  const follow = (field: keyof typeof identity) => (event: { target: { value: string } }) =>
    setIdentity((current) => ({ ...current, [field]: event.target.value }));

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
            <Input
              id={id}
              name="nameFirst"
              inputSize="lg"
              leadingIcon={<User />}
              required
              onChange={follow("nameFirst")}
            />
          )}
        </FormField>
        <FormField label={t("lastName")}>
          {(id) => (
            <Input id={id} name="nameLast" inputSize="lg" required onChange={follow("nameLast")} />
          )}
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
            onChange={follow("email")}
          />
        )}
      </FormField>

      <FormField label={tl("password")} description={t("passwordHint")}>
        {(id) => (
          <>
            <PasswordInput
              id={id}
              name="password"
              inputSize="lg"
              placeholder="••••••••••"
              leadingIcon={<Lock />}
              autoComplete="new-password"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
            <NewPasswordStrength
              password={password}
              identity={identityFragments(identity.email, identity.nameFirst, identity.nameLast)}
            />
          </>
        )}
      </FormField>

      <CaptchaField siteKey={captchaSiteKey} />

      <Button size="lg" fullWidth type="submit" loading={pending}>
        {t("submit")} <ArrowRight />
      </Button>
    </form>
  );
}
