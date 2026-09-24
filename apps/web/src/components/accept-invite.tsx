"use client";

import { identityFragments } from "@gamedashboard/contracts";
import { AlertBanner, Button, FormField, Input, PasswordInput } from "@gamedashboard/ui";
import { Check, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { NewPasswordStrength } from "@/components/new-password-strength";
import { acceptInvite, registerFromInvite } from "@/server/api/invitations";

/**
 * Création du compte de l'invité, puis acceptation.
 *
 * **L'adresse n'est pas demandée** : elle est scellée dans l'invitation, et
 * la laisser saisir ferait de ce formulaire une inscription libre déguisée —
 * exactement ce que le réglage « inscriptions fermées » interdit.
 */
export function RegisterFromInvite({ token, email }: { token: string; email: string }) {
  const t = useTranslations("invitation");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [nameFirst, setNameFirst] = useState("");
  const [nameLast, setNameLast] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  const complet = nameFirst.trim() !== "" && nameLast.trim() !== "" && password !== "";

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <AlertBanner variant="danger" title={t("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      <FormField label={tc("email")} description={t("emailSealed")}>
        {(id) => <Input id={id} value={email} readOnly disabled className="gd-mono" />}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("firstName")}>
          {(id) => (
            <Input id={id} value={nameFirst} onChange={(e) => setNameFirst(e.target.value)} />
          )}
        </FormField>
        <FormField label={t("lastName")}>
          {(id) => <Input id={id} value={nameLast} onChange={(e) => setNameLast(e.target.value)} />}
        </FormField>
      </div>

      <FormField label={tc("password")} description={t("passwordHint")}>
        {(id) => (
          <>
            <PasswordInput
              id={id}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <NewPasswordStrength
              password={password}
              identity={identityFragments(email, nameFirst, nameLast)}
            />
          </>
        )}
      </FormField>

      <Button
        size="lg"
        fullWidth
        disabled={!complet || pending}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await registerFromInvite(token, {
              nameFirst: nameFirst.trim(),
              nameLast: nameLast.trim(),
              password,
            });
            if (result.error || !result.serverId) {
              setError(result.error ?? t("refused"));
              return;
            }
            router.replace(`/server/${result.serverId}`);
          })
        }
      >
        <UserPlus /> {t("createAndAccept")}
      </Button>
    </div>
  );
}

/**
 * Le clic qui transforme l'invitation en accès.
 *
 * Un bouton et non un effet au chargement : le lien accorde un pouvoir sur le
 * serveur d'un tiers, et un aperçu automatique de messagerie l'accepterait
 * sinon à la place du destinataire.
 *
 * En cas de succès on part **sur le serveur**, pas sur la liste : c'est ce
 * qu'on vient d'obtenir, et le chercher dans une liste après avoir accepté
 * ferait douter que l'accès ait été pris.
 */
export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations("invitation");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <AlertBanner variant="danger" title={t("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      <Button
        size="lg"
        fullWidth
        disabled={pending}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await acceptInvite(token);
            if (result.error || !result.serverId) {
              setError(result.error ?? t("refused"));
              return;
            }
            router.replace(`/server/${result.serverId}`);
          })
        }
      >
        <Check /> {t("accept")}
      </Button>
    </div>
  );
}
