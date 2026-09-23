"use client";

import {
  AlertBanner,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  FormField,
  Input,
  SelectMenu,
} from "@gamedashboard/ui";
import { Ban, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { AdminUser } from "@/server/api/admin";
import { sendPasswordReset, setUserSuspended, updateUser } from "@/server/api/admin-user-actions";

/**
 * Les trois gestes de l'administration sur un compte existant : le corriger,
 * lui envoyer un lien de réinitialisation, le suspendre.
 *
 * Chaque fenêtre dit **avant** de valider ce que le geste va provoquer : une
 * adresse changée n'est plus vérifiée, une suspension déconnecte sur-le-champ.
 * Aucune ne montre ni ne choisit de mot de passe.
 */

interface Props {
  user: AdminUser;
  onClose: () => void;
  /** Rend compte du résultat : message de réussite, ou d'échec. */
  onDone: (result: { error: string | null; notice: string | null }) => void;
}

export function AdminUserEditDialog({ user, onClose, onDone }: Props) {
  const t = useTranslations("adminUserEdit");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(user.email);
  const [nameFirst, setNameFirst] = useState(user.nameFirst);
  const [nameLast, setNameLast] = useState(user.nameLast);
  const [locale, setLocale] = useState(user.locale === "en" ? "en" : "fr");
  const [error, setError] = useState<string | null>(null);

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();

  const submit = () =>
    startTransition(async () => {
      const result = await updateUser(user.id, {
        email: email.trim(),
        nameFirst: nameFirst.trim(),
        nameLast: nameLast.trim(),
        locale: locale as "fr" | "en",
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      const notice = !result.emailChanged
        ? t("saved")
        : result.verification === "sent"
          ? t("savedVerificationSent", { email: email.trim() })
          : t("savedVerificationNotSent");
      onDone({ error: null, notice });
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t("editTitle")}
        description={t("editHint", { email: user.email })}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || !email.trim() || !nameFirst.trim() || !nameLast.trim()}
              onClick={submit}
            >
              <Save /> {tc("save")}
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
          <FormField label={t("email")} description={t("emailHint")}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </FormField>
          {/* Dit au moment où on la tape, pas après : la nouvelle adresse
              repasse « non vérifiée » et un courrier part vers elle. */}
          {emailChanged ? (
            <AlertBanner variant="warning">{t("emailChangeWarning")}</AlertBanner>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("firstName")}>
              {(id) => (
                <Input id={id} value={nameFirst} onChange={(e) => setNameFirst(e.target.value)} />
              )}
            </FormField>
            <FormField label={t("lastName")}>
              {(id) => (
                <Input id={id} value={nameLast} onChange={(e) => setNameLast(e.target.value)} />
              )}
            </FormField>
          </div>
          <FormField label={t("locale")} description={t("localeHint")}>
            {(id) => (
              <SelectMenu
                id={id}
                value={locale}
                onValueChange={setLocale}
                options={[
                  { value: "fr", label: t("localeFr") },
                  { value: "en", label: t("localeEn") },
                ]}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Envoie au titulaire un lien pour choisir lui-même un nouveau mot de passe. */
export function AdminUserResetDialog({ user, onClose, onDone }: Props) {
  const t = useTranslations("adminUserEdit");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("resetTitle")}
      description={t("resetBody", { email: user.email })}
      confirmLabel={t("resetConfirm")}
      cancelLabel={tc("cancel")}
      loading={pending}
      onConfirm={() =>
        startTransition(async () => {
          const result = await sendPasswordReset(user.id);
          onDone({
            error: result.error,
            notice: result.sentTo ? t("resetSent", { email: result.sentTo }) : null,
          });
        })
      }
    />
  );
}

/**
 * Suspend ou réactive un compte.
 *
 * Le motif est exigé : c'est la première chose que le support voudra savoir
 * quand le client appellera. Il reste interne, le titulaire ne le voit pas.
 */
export function AdminUserSuspendDialog({ user, onClose, onDone }: Props) {
  const t = useTranslations("adminUserEdit");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const suspended = user.suspendedAt !== null;

  if (suspended) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={t("reactivateTitle", { name: user.name })}
        description={t("reactivateBody", { reason: user.suspensionReason ?? tc("none") })}
        confirmLabel={t("reactivateConfirm")}
        cancelLabel={tc("cancel")}
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            const result = await setUserSuspended(user.id, { suspended: false });
            onDone({ error: result.error, notice: result.error ? null : t("reactivated") });
          })
        }
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t("suspendTitle", { name: user.name })}
        description={t("suspendHint")}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={pending || reason.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await setUserSuspended(user.id, {
                    suspended: true,
                    reason: reason.trim(),
                  });
                  onDone({
                    error: result.error,
                    notice: result.error ? null : t("suspended", { count: result.revokedSessions }),
                  });
                })
              }
            >
              <Ban /> {t("suspendConfirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-muted text-sm">
            <li>{t("suspendEffectLogin")}</li>
            <li>{t("suspendEffectSessions")}</li>
            <li>{t("suspendEffectKeys")}</li>
            <li className="text-fg">{t("suspendEffectServers")}</li>
          </ul>
          <FormField label={t("reason")} description={t("reasonHint")}>
            {(id) => (
              <Input
                id={id}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("reasonPlaceholder")}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Le geste en cours sur un compte, et le compte visé. */
export type AccountGesture = { kind: "edit" | "reset" | "suspend"; user: AdminUser };

/** Ouvre la bonne fenêtre pour le geste demandé depuis la ligne d'un compte. */
export function AccountGestureDialog({
  gesture,
  onClose,
  onDone,
}: {
  gesture: AccountGesture;
  onClose: Props["onClose"];
  onDone: Props["onDone"];
}) {
  const props = { user: gesture.user, onClose, onDone };
  if (gesture.kind === "edit") return <AdminUserEditDialog {...props} />;
  if (gesture.kind === "reset") return <AdminUserResetDialog {...props} />;
  return <AdminUserSuspendDialog {...props} />;
}
