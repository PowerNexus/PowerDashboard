"use client";

import { AlertBanner, Button } from "@gamedashboard/ui";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { resendVerificationEmail } from "@/server/api/email-verification";

/**
 * Bandeau « votre adresse n'est pas confirmée ».
 *
 * Il **n'empêche rien**. C'est délibéré : une adresse non confirmée n'est pas
 * un compte suspect, c'est un courriel qu'on n'a pas encore ouvert. Bloquer le
 * panel pour cela enfermerait dehors quelqu'un dont le courrier est arrivé
 * dans les indésirables — alors que c'est précisément le cas où il a besoin
 * d'un bouton pour en redemander un.
 *
 * Il compte en revanche le jour où l'adresse sert : c'est par elle que part une
 * réinitialisation de mot de passe, et une adresse jamais confirmée est une
 * porte de secours dont on ignore si elle s'ouvre.
 */
export function EmailVerificationNotice({ email }: { email: string }) {
  const t = useTranslations("emailVerification");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <AlertBanner variant="success" title={t("resentTitle")} dismissible>
        {t("resentBody", { email })}
      </AlertBanner>
    );
  }

  return (
    <AlertBanner variant="warning" title={t("noticeTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{error ?? t("noticeBody", { email })}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await resendVerificationEmail();
              setError(result.error);
              // L'écran ne dit « envoyé » que si l'API a accepté : afficher la
              // confirmation sur une panne ferait attendre un courriel qui ne
              // partira pas.
              if (!result.error) setSent(true);
            })
          }
        >
          <MailCheck /> {t("resend")}
        </Button>
      </div>
    </AlertBanner>
  );
}
