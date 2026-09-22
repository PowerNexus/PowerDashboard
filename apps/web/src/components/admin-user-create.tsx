"use client";

import {
  AlertBanner,
  Button,
  Dialog,
  DialogContent,
  FormField,
  Input,
  SelectMenu,
  SettingToggle,
} from "@gamedashboard/ui";
import { Copy, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createUser } from "@/server/api/admin-actions";

const ROLES = ["user", "reseller", "support", "admin"] as const;

/**
 * Création d'un compte depuis l'administration.
 *
 * L'écran ne demande **pas** de mot de passe. Un champ de ce genre, dans un
 * formulaire d'administration, reçoit dans les faits un secret que la personne
 * qui remplit connaît déjà et réutilise ailleurs. Il est tiré au sort, affiché
 * une fois, et transmis de la main à la main.
 */
export function AdminUserCreate() {
  const t = useTranslations("adminUsers");
  const tr = useTranslations("role");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [nameFirst, setNameFirst] = useState("");
  const [nameLast, setNameLast] = useState("");
  const [role, setRole] = useState<string>("user");
  const [withPassword, setWithPassword] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createUser({ email, nameFirst, nameLast, role, withPassword });
      if (result.error) {
        setError(result.error);
        return;
      }

      // La fenêtre se ferme, mais le secret reste affiché derrière : le fermer
      // en même temps que le formulaire ferait disparaître la seule occasion
      // de le lire.
      setOpen(false);
      setCreated({ email, password: result.temporaryPassword });
      setEmail("");
      setNameFirst("");
      setNameLast("");
      router.refresh();
    });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus /> {t("create")}
      </Button>

      {created ? (
        <AlertBanner
          variant="success"
          title={t("createdTitle", { email: created.email })}
          dismissible
        >
          {created.password ? (
            <div className="flex flex-col gap-2">
              <p>{t("createdWithPassword")}</p>
              <code className="gd-mono select-all rounded-field border border-border bg-surface-2 px-3 py-2 text-fg text-sm">
                {created.password}
              </code>
              <p className="text-xs">
                <Copy className="inline size-3.5" /> {t("createdCopyHint")}
              </p>
            </div>
          ) : (
            <p>{t("createdWithoutPassword")}</p>
          )}
        </AlertBanner>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("create")}
          description={t("createHint")}
          footer={
            <Button
              disabled={
                pending || email.trim() === "" || nameFirst.trim() === "" || nameLast.trim() === ""
              }
              onClick={submit}
            >
              <UserPlus /> {t("createAction")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {error ? (
              <AlertBanner variant="danger" title={tc("actionRefused")}>
                {error}
              </AlertBanner>
            ) : null}

            <FormField label={t("emailLabel")}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="paul@exemple.fr"
                  autoComplete="off"
                />
              )}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("firstNameLabel")}>
                {(id) => (
                  <Input
                    id={id}
                    value={nameFirst}
                    onChange={(e) => setNameFirst(e.target.value)}
                    autoComplete="off"
                  />
                )}
              </FormField>
              <FormField label={t("lastNameLabel")}>
                {(id) => (
                  <Input
                    id={id}
                    value={nameLast}
                    onChange={(e) => setNameLast(e.target.value)}
                    autoComplete="off"
                  />
                )}
              </FormField>
            </div>

            <FormField label={t("roleLabel")} description={t("roleHint")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={role}
                  onValueChange={setRole}
                  options={ROLES.map((value) => ({ value, label: tr(value) }))}
                />
              )}
            </FormField>

            <SettingToggle
              label={t("withPasswordLabel")}
              description={withPassword ? t("withPasswordHint") : t("withoutPasswordHint")}
              checked={withPassword}
              onCheckedChange={setWithPassword}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
