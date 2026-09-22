"use client";

import { AlertBanner, Badge, Button, PageHeader, PageTemplate } from "@gamedashboard/ui";
import { ArrowLeft, FileCode, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { CodeEditor, languageForFile } from "@/components/code-editor";
import { writeFile } from "@/server/api/files";
import { ServerBlockBanner, useServerBlock } from "./server-block-context";

/**
 * Éditeur de fichier.
 *
 * Le contenu vient du daemon, chargé côté serveur et passé en propriété : le
 * navigateur ne lit jamais le volume directement.
 */
export function FileEditorWorkspace({
  serverId,
  path,
  initialContent,
}: {
  serverId: string;
  path: string;
  initialContent: string;
}) {
  const t = useTranslations("fileEditor");
  const tc = useTranslations("common");
  const fileName = path.split("/").filter(Boolean).pop() ?? path;
  const [saved, setSaved] = useState(initialContent);
  const [value, setValue] = useState(initialContent);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /*
   * Le fichier reste lisible, mais il ne se réécrit pas.
   *
   * L'inverse — fermer l'éditeur — cacherait le contenu à quelqu'un qui
   * cherche justement à comprendre pourquoi son serveur est dans cet état.
   */
  const fige = useServerBlock() !== null;

  const dirty = value !== saved;
  const language = languageForFile(fileName);

  /**
   * L'état « à jour » n'est posé qu'après confirmation de l'écriture.
   *
   * Afficher « Enregistré » avant la réponse du daemon ferait fermer l'onglet
   * à quelqu'un dont la modification n'a jamais atteint le disque.
   */
  const save = () => {
    const attempted = value;
    startTransition(async () => {
      const result = await writeFile(serverId, path, attempted);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(attempted);
      setError(null);
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
    });
  };

  return (
    <PageTemplate
      notice={<ServerBlockBanner />}
      header={
        <PageHeader
          icon={<FileCode />}
          title={fileName}
          subtitle={
            <span className="gd-mono">
              /home/container{path.startsWith("/") ? path : `/${path}`}
            </span>
          }
          breadcrumbs={[
            { label: t("files"), href: `/server/${serverId}/files` },
            { label: fileName },
          ]}
          actions={
            <>
              <Badge variant={dirty ? "warning" : "neutral"}>
                {dirty ? t("unsaved") : t("upToDate")}
              </Badge>
              {/*
               * Le retour est **toujours** visible, et c'est le point.
               *
               * Une fois enregistré, « Rétablir » et « Enregistrer » se
               * désactivent tous les deux : il ne restait plus qu'un fil
               * d'Ariane discret pour ressortir, et on se retrouvait coincé
               * dans l'éditeur sans bouton actif à l'écran.
               */}
              <Button variant="secondary" asChild>
                <Link href={`/server/${serverId}/files`}>
                  <ArrowLeft /> {t("backToFiles")}
                </Link>
              </Button>
              <Button
                variant="secondary"
                disabled={!dirty || pending || fige}
                onClick={() => setValue(saved)}
              >
                <RotateCcw /> {t("revert")}
              </Button>
              <Button disabled={!dirty || pending || fige} loading={pending} onClick={save}>
                <Save /> {tc("save")}
              </Button>
            </>
          }
        />
      }
      toolbar={
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-3 text-sm shadow-card">
          <span className="text-muted">
            {t("detectedLanguage")} <span className="gd-mono text-fg">{language}</span> ·{" "}
            <kbd className="rounded-xs border border-border px-1.5 py-0.5 text-[11px] font-semibold">
              Ctrl S
            </kbd>{" "}
            {t("toSave")}
          </span>
          {/*
           * L'heure d'enregistrement et le retour ne sont **pas** des
           * alternatives.
           *
           * Ils l'étaient : le lien vivait dans la branche `else` de
           * l'horodatage, donc enregistrer le faisait disparaître — au moment
           * précis où l'on a fini et où l'on veut ressortir. Les deux boutons
           * d'action se désactivant aussi, il ne restait plus rien de
           * cliquable à l'écran.
           */}
          <span className="flex flex-wrap items-center gap-4">
            {savedAt ? (
              <span className="text-success-ink">{t("savedAt", { time: savedAt })}</span>
            ) : null}
            <Link
              href={`/server/${serverId}/files`}
              className="font-semibold text-accent hover:underline"
            >
              {t("backToFiles")}
            </Link>
          </span>
        </div>
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={t("saveRefused")}>
          {error}
        </AlertBanner>
      ) : null}
      <CodeEditor value={value} language={language} onChange={setValue} onSave={save} />
    </PageTemplate>
  );
}
