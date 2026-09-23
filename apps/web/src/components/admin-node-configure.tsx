"use client";

import { wingsConfigureCommand } from "@gamedashboard/contracts";
import { AlertBanner, Badge, Button } from "@gamedashboard/ui";
import { Download, FileCode2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { issueNodeConfigureToken, loadNodeConfiguration } from "@/server/api/admin-actions";
import { downloadText } from "./admin-node-binding";

/**
 * Mise en service d'un daemon sur une machine neuve.
 *
 * La commande porte une **clé d'amorçage** émise à l'ouverture de cette
 * fenêtre, et non une clé permanente qu'il faudrait créer à la main puis
 * penser à retirer. Trois bornes la rendent négligeable si elle fuite : une
 * seule portée, un seul node, un seul usage — et trente minutes.
 *
 * Ce n'est pas le jeton du daemon. Celui-là est ce que le panel rendra à Wings
 * en réponse ; la clé affichée ici est seulement ce qui autorise à le demander.
 * Confondre les deux est l'erreur que cet écran existe pour éviter.
 *
 * Panneau posé dans la page — section « Installation » de la fiche, étape 2 du
 * parcours « Ajouter une machine » — et non plus fenêtre : les étapes se
 * lisent en suivant, un terminal ouvert à côté.
 */
export function AdminNodeConfigure({
  node,
  panelOrigin,
}: {
  node: { id: string; name: string };
  panelOrigin: string;
}) {
  const t = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yaml, setYaml] = useState<string | null>(null);

  // Chargé à la demande, jamais à l'ouverture : le fichier porte le jeton du
  // daemon en clair, et la plupart des mises en service passent par la commande.
  const loadFile = () =>
    startTransition(async () => {
      const result = await loadNodeConfiguration(node.id);
      setError(result.error);
      setYaml(result.yaml);
    });

  /*
   * Le fichier s'enregistre sans repasser par le serveur : le contenu est déjà
   * dans la page, et une seconde route de téléchargement ferait un second
   * endroit où ce secret circule, pour le même octet.
   */
  const download = (contents: string) => downloadText(contents, "config.yml");

  const issue = useCallback(
    () =>
      startTransition(async () => {
        const result = await issueNodeConfigureToken(node.id);
        setError(result.error);
        setToken(result.token);
        setExpiresAt(result.expiresAt);
      }),
    [node.id],
  );

  // Émise à l'affichage du panneau : une clé ne se crée qu'au moment où l'on
  // s'apprête à s'en servir, jamais au rendu d'une liste.
  useEffect(() => {
    issue();
  }, [issue]);

  const command = wingsConfigureCommand({
    panelOrigin,
    nodeId: node.id,
    token: token ?? undefined,
  });

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted text-sm">{t("configureHint")}</p>
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")}>
          {error}
        </AlertBanner>
      ) : null}

      <ol className="flex flex-col gap-4">
        <li className="flex flex-col gap-2">
          <span className="font-semibold text-fg text-sm">{t("configureStepRun")}</span>
          {/* `select-all` : la commande se prend d'un clic, sans bouton à
                  entretenir ni permission de presse-papiers à demander. */}
          <code className="gd-mono select-all break-all rounded-field border border-border bg-surface-2 p-3 text-fg text-xs">
            {pending && token === null ? t("configureIssuing") : command}
          </code>

          <div className="flex flex-wrap items-center gap-2">
            {/* La clé ne vaut rien passé son échéance, et rien non plus une
                    fois que Wings l'a utilisée. Le dire évite de chercher
                    pourquoi une commande gardée d'hier est refusée. */}
            <Badge variant="neutral">{t("configureTokenScope")}</Badge>
            {expiresAt ? (
              <Badge variant="warning">
                {t("configureTokenExpiry", {
                  time: new Date(expiresAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </Badge>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending} onClick={issue}>
              <RefreshCw /> {t("configureReissue")}
            </Button>
          </div>

          {/* Le `--node` n'est pas décoratif : sans lui, Wings pose la
                  question et n'accepte alors qu'un entier décimal, héritage
                  des identifiants numériques de Pterodactyl. Nos nodes sont
                  des UUID, et la commande serait impossible à finir. */}
          <p className="text-faint text-xs">{t("configureNodeFlagHint")}</p>
        </li>
        <li className="flex flex-col gap-2">
          <span className="font-semibold text-fg text-sm">{t("configureStepStart")}</span>
          <p className="text-muted text-sm">{t("configureStepStartBody")}</p>
        </li>
      </ol>

      {/*
            Le fichier, pour les machines que la commande ne peut pas joindre.
            Un node derrière un réseau qui n'atteint pas le panel, ou un daemon
            déjà installé qu'on ne veut pas reconfigurer en aveugle : dans les
            deux cas il reste à déposer le fichier soi-même. Il n'est chargé
            qu'à la demande, parce qu'il porte le jeton du daemon en clair.
          */}
      <div className="flex flex-col gap-2 border-border border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-fg text-sm">{t("fileTitle")}</p>
            <p className="text-muted text-xs">{t("fileHint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={pending} onClick={loadFile}>
              <FileCode2 /> {yaml === null ? t("fileShow") : t("fileReload")}
            </Button>
            {yaml ? (
              <Button size="sm" variant="ghost" onClick={() => download(yaml)}>
                <Download /> {t("fileDownload")}
              </Button>
            ) : null}
          </div>
        </div>
        {yaml ? (
          <pre className="gd-mono max-h-64 select-all overflow-auto rounded-field border border-border bg-surface-2 p-3 text-fg text-xs">
            {yaml}
          </pre>
        ) : null}
      </div>

      {/* Ce que la commande rapporte vaut le contrôle de la machine : le
              dire ici, au moment où l'on s'apprête à coller une clé dans un
              terminal, plutôt que dans une documentation qu'on lira après. */}
      <AlertBanner variant="warning" title={t("configureSecretTitle")}>
        {t("configureSecretBody")}
      </AlertBanner>
    </div>
  );
}
