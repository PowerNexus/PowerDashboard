"use client";

import {
  ENGINE_EXCLUSIONS,
  type EngineOption,
  overwritesServerFiles,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
  PageTemplate,
  SelectMenu,
} from "@gamedashboard/ui";
import { Boxes, Cpu, PackageX, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type EngineState, type EulaState, installEngine } from "@/server/api/engine";
import { ServerBlockBanner, useServerBlock } from "./server-block-context";

/**
 * Une carte de moteur : plateforme ou modpack, même forme.
 *
 * L'uniformité est le sujet : ce sont deux façons de répondre à la même
 * question — qu'est-ce que ce serveur fait tourner ? Deux écrans obligeraient
 * à deviner lequel ouvrir avant de savoir ce qu'on cherche.
 */
function EngineCard({
  option,
  busy,
  onInstall,
}: {
  option: EngineOption;
  busy: boolean;
  onInstall: (versionId: string) => void;
}) {
  const t = useTranslations("engine");
  // La version la plus récente est préchoisie : c'est celle qu'on installe
  // neuf fois sur dix, et la lire dans la liste ne coûte rien à qui veut autre chose.
  const [versionId, setVersionId] = useState(option.versions[0]?.id ?? "");

  return (
    <Card className="flex flex-col">
      <CardBody className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate font-semibold text-fg">{option.label}</p>
          <Badge variant={option.kind === "pack" ? "warning" : "accent"}>
            {option.kind === "pack" ? t("kindPack") : t("kindJar")}
          </Badge>
        </div>

        <p className="flex-1 text-muted text-sm leading-relaxed">{option.summary}</p>

        <div className="flex flex-wrap items-center gap-2 border-border border-t pt-3">
          <SelectMenu
            className="min-w-40 flex-1"
            value={versionId}
            onValueChange={setVersionId}
            options={option.versions.map((version) => ({
              value: version.id,
              label: version.label,
            }))}
          />
          <Button
            size="sm"
            disabled={busy || versionId === ""}
            onClick={() => onInstall(versionId)}
          >
            {t("install")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Le moteur d'un serveur : ce qu'il **est**, et non ce qu'on lui ajoute.
 *
 * Un jar de serveur et un modpack vivent ici ensemble parce qu'ils font la
 * même chose à deux échelles : remplacer le programme, ou le remplacer avec
 * tout ce qui l'accompagne. Les extensions, elles, s'ajoutent et se retirent
 * sans que le serveur cesse d'être ce qu'il est — c'est l'autre écran.
 */
export function EngineWorkspace({
  serverId,
  initial,
  eula,
  query: initialQuery,
}: {
  serverId: string;
  initial: EngineState;
  /** Contrat de licence Minecraft, quand ce serveur est concerné. */
  eula: EulaState | null;
  query: string;
}) {
  const t = useTranslations("engine");
  const tc = useTranslations("common");
  const router = useRouter();

  const [query, setQuery] = useState(initialQuery);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /*
   * Changer de moteur arrête le serveur, remplace des fichiers et en supprime
   * d'autres : c'est l'écriture la plus lourde du panel. La proposer pendant
   * une installation reviendrait à en lancer une seconde par-dessus la
   * première.
   */
  const bloc = useServerBlock();
  /** Le choix en attente de confirmation : rien ne part sans passer par là. */
  const [toInstall, setToInstall] = useState<{ option: EngineOption; versionId: string } | null>(
    null,
  );

  const confirm = () =>
    startTransition(async () => {
      if (!toInstall) return;
      const result = await installEngine(serverId, toInstall.option.id, toInstall.versionId);
      setError(result.error);
      setToInstall(null);
      if (!result.error) router.refresh();
    });

  const version = toInstall?.option.versions.find((v) => v.id === toInstall.versionId);

  return (
    <PageTemplate
      notice={<ServerBlockBanner />}
      header={<PageHeader icon={<Cpu />} title={t("title")} subtitle={t("subtitle")} />}
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {initial.runtime === null ? (
        <AlertBanner variant="warning" title={t("unavailable")}>
          {initial.unavailableReason}
        </AlertBanner>
      ) : (
        <>
          {/* Dit une fois, en haut, plutôt que sur chaque carte : changer de
              moteur écrase toujours l'existant, quel que soit celui qu'on
              choisit. */}
          <AlertBanner variant="info" title={t("beforeYouStart")}>
            {t("beforeYouStartBody")}
          </AlertBanner>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold text-fg text-lg">{t("platforms")}</h2>
            <p className="text-muted text-sm">{t("platformsHint")}</p>
            {initial.platforms.length === 0 ? (
              <EmptyState
                icon={<PackageX />}
                title={t("noPlatform")}
                description={t("noPlatformHint")}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {initial.platforms.map((option) => (
                  <EngineCard
                    key={option.id}
                    option={option}
                    busy={pending || bloc !== null}
                    onInstall={(versionId) => setToInstall({ option, versionId })}
                  />
                ))}
              </div>
            )}

            {/*
              Les plateformes connues mais absentes, et pourquoi.

              Sans cette liste, « Forge n'est pas proposé » se lit comme une
              panne du panel : on cherche un bouton, on recharge, on finit par
              demander au support. Ce sont des faits sur l'outil — Forge et
              NeoForge ne publient qu'un installeur, Quilt qu'un profil de
              lancement — et les dire coûte trois lignes.

              Affichées seulement quand des plateformes le sont aussi : sur un
              jeu qui n'est pas Minecraft-Java, expliquer l'absence de Forge
              n'apprendrait rien à personne.
            */}
            {initial.platforms.length > 0 ? (
              <div className="flex flex-col gap-1 rounded-field border border-border bg-surface p-4">
                <p className="font-semibold text-fg text-sm">{t("excludedTitle")}</p>
                {ENGINE_EXCLUSIONS.map((exclusion) => (
                  <p key={exclusion.label} className="text-muted text-xs">
                    <span className="font-semibold text-fg">{exclusion.label}</span> —{" "}
                    {exclusion.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </section>

          {/* Les modpacks ne sont proposés qu'aux chargeurs de mods : en poser
              un sur un Paper écraserait le serveur par une arborescence qu'il
              ne sait pas lire. */}
          {initial.packs.length > 0 || query !== "" ? (
            <section className="flex flex-col gap-3">
              <h2 className="font-semibold text-fg text-lg">{t("packs")}</h2>
              <p className="text-muted text-sm">{t("packsHint")}</p>

              <form
                className="flex flex-wrap gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = query.trim();
                  router.push(
                    `/server/${serverId}/engine${next === "" ? "" : `?q=${encodeURIComponent(next)}`}`,
                  );
                }}
              >
                <Input
                  className="min-w-64 flex-1"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchPacks")}
                  leadingIcon={<Search />}
                />
                <Button type="submit" variant="secondary" disabled={pending}>
                  {tc("search")}
                </Button>
              </form>

              {initial.packs.length === 0 ? (
                <EmptyState icon={<Boxes />} title={t("noPack")} description={t("noPackHint")} />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {initial.packs.map((option) => (
                    <EngineCard
                      key={option.id}
                      option={option}
                      busy={pending || bloc !== null}
                      onInstall={(versionId) => setToInstall({ option, versionId })}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </>
      )}

      {/*
       * La confirmation dit ce qui va être écrasé, et ce n'est pas le même
       * texte selon la nature du moteur : un jar remplace un fichier, un
       * modpack déverse une arborescence par-dessus l'existante. La différence
       * ne se rattrape pas après coup.
       */}
      <ConfirmDialog
        open={toInstall !== null}
        onOpenChange={(open) => !open && setToInstall(null)}
        title={t("confirmTitle", {
          name: toInstall?.option.label ?? "",
          version: version?.label ?? "",
        })}
        description={[
          toInstall && overwritesServerFiles(toInstall.option.kind)
            ? t("confirmPackBody")
            : t("confirmJarBody"),
          /*
           * Le retrait de l'acceptation est annoncé **avant** le geste.
           *
           * Un serveur qui refuse de démarrer après une installation réussie
           * est le genre de surprise qu'on met vingt minutes à comprendre. Le
           * dire ici coûte une phrase et l'évite entièrement.
           */
          eula?.applicable ? t("confirmEulaReset") : "",
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("install")}
        destructive
        loading={pending}
        onConfirm={confirm}
      />
    </PageTemplate>
  );
}
