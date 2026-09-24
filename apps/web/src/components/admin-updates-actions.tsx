"use client";

import { AlertBanner, Button, ConfirmDialog } from "@gamedashboard/ui";
import { RefreshCw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { checkForUpdate, rollbackUpdate } from "@/server/api/updates";

/** Les deux gestes de la carte « Mises à jour » : vérifier, revenir en arrière. */
export function AdminUpdatesActions({
  busy,
  current,
  previous,
}: {
  busy: boolean;
  current: string;
  previous: string | null;
}) {
  const t = useTranslations("adminUpdates");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = (action: () => Promise<{ error: string | null }>, done: string) =>
    startTransition(async () => {
      const { error } = await action();
      setMessage(error ? { tone: "danger", text: error } : { tone: "success", text: done });
      if (!error) router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {message ? <AlertBanner variant={message.tone}>{message.text}</AlertBanner> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || pending}
          onClick={() => run(checkForUpdate, t("checkStarted"))}
        >
          <RefreshCw /> {t("check")}
        </Button>
        {previous ? (
          <Button variant="ghost" disabled={busy || pending} onClick={() => setConfirming(true)}>
            <Undo2 /> {t("rollback", { version: previous })}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("rollbackTitle")}
        description={t("rollbackBody", { previous: previous ?? "", current })}
        confirmLabel={t("rollback", { version: previous ?? "" })}
        destructive
        onConfirm={() => {
          setConfirming(false);
          run(rollbackUpdate, t("rollbackDone", { version: previous ?? "" }));
        }}
      />
    </div>
  );
}
