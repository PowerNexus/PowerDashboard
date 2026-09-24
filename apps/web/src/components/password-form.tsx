"use client";

import type { PasswordProblem } from "@gamedashboard/contracts";
import { AlertBanner, Button, FormField, PasswordInput, SettingsSection } from "@gamedashboard/ui";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { changePassword } from "@/server/api/password";

/**
 * Changement de mot de passe.
 *
 * Le formulaire ne juge pas la solidité du mot de passe : c'est l'API qui
 * applique la politique, longueur comme présence dans les fuites connues. Le
 * seul contrôle fait ici est la correspondance des deux saisies, parce qu'il
 * ne demande aucune connaissance de la règle et évite un aller-retour pour une
 * faute de frappe.
 */
export function PasswordForm({ provisional = false }: { provisional?: boolean }) {
  const t = useTranslations("security");
  const tc = useTranslations("common");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<PasswordProblem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mismatch = confirmation !== "" && next !== confirmation;
  const complete = current !== "" && next !== "" && confirmation !== "";

  /** Chaque manquement devient une phrase, dans la langue du lecteur. */
  const describe = (problem: PasswordProblem): string => {
    switch (problem.kind) {
      case "too-short":
        return t("problemTooShort", { minimum: problem.minimum });
      case "too-long":
        return t("problemTooLong", { maximum: problem.maximum });
      case "contains-identity":
        return t("problemContainsIdentity");
      case "pwned":
        return t("problemPwned", { occurrences: problem.occurrences });
    }
  };

  const submit = () => {
    if (mismatch) {
      setError(t("mismatch"));
      return;
    }
    startTransition(async () => {
      const result = await changePassword(current, next);
      setProblems(result.problems);
      // Un refus de politique est déjà décrit par `problems`, traduits
      // ci-dessus. Répéter la phrase française de l'API par-dessus afficherait
      // la même chose deux fois, dans deux langues.
      setError(result.problems.length > 0 ? null : result.error);
      if (result.error) {
        setNotice(null);
        setWarning(null);
        return;
      }

      setNotice(
        result.revokedSessions
          ? t("passwordChangedAnd", { count: result.revokedSessions })
          : t("passwordChanged"),
      );
      setWarning(result.pwnedCheckFailed ? t("pwnedCheckFailed") : null);
      // Les champs sont vidés : laisser un mot de passe en clair dans un
      // formulaire d'une page qu'on quitte rarement n'apporte rien.
      setCurrent("");
      setNext("");
      setConfirmation("");
    });
  };

  return (
    <SettingsSection
      title={t("passwordSection")}
      description={t("newPasswordHint")}
      footer={
        <Button disabled={!complete || mismatch || pending} onClick={submit}>
          {t("updatePassword")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Le mot de passe tiré par un script d'exploitation expire : le dire
            ici, à l'endroit où l'on en choisit un autre. Il disparaît dès que
            le changement a eu lieu. */}
        {provisional && !notice ? (
          <AlertBanner variant="warning" title={t("provisionalTitle")}>
            {t("provisionalBody")}
          </AlertBanner>
        ) : null}
        {error ? (
          <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
            {error}
          </AlertBanner>
        ) : null}
        {problems.length > 0 ? (
          <AlertBanner variant="danger" title={tc("actionRefused")}>
            <ul className="list-disc pl-4">
              {problems.map((problem) => (
                <li key={problem.kind}>{describe(problem)}</li>
              ))}
            </ul>
          </AlertBanner>
        ) : null}
        {notice ? (
          <AlertBanner variant="success" title={tc("done")} dismissible>
            {notice}
          </AlertBanner>
        ) : null}
        {/* Le changement a eu lieu ; seul le contrôle des fuites a été sauté.
            Le taire laisserait croire à une vérification qui n'a pas eu lieu. */}
        {warning ? (
          <AlertBanner variant="warning" dismissible>
            {warning}
          </AlertBanner>
        ) : null}

        <FormField label={t("currentPassword")}>
          {(id) => (
            <PasswordInput
              id={id}
              leadingIcon={<Lock />}
              autoComplete="current-password"
              value={current}
              disabled={pending}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("newPassword")}>
            {(id) => (
              <PasswordInput
                id={id}
                leadingIcon={<Lock />}
                autoComplete="new-password"
                value={next}
                disabled={pending}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("confirmation")} error={mismatch ? t("mismatch") : undefined}>
            {(id) => (
              <PasswordInput
                id={id}
                leadingIcon={<Lock />}
                autoComplete="new-password"
                value={confirmation}
                disabled={pending}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </div>
    </SettingsSection>
  );
}
