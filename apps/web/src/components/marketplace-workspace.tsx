"use client";

import {
  type AddonState,
  MARKETPLACE_SOURCE_LABEL,
  type MarketplaceProject,
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
  Select,
} from "@gamedashboard/ui";
import {
  ArrowUpCircle,
  Ban,
  Check,
  Download,
  History,
  Package,
  PackageX,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";
import {
  type Catalogue,
  installAddon,
  uninstallAddon,
  updateAllAddons,
} from "@/server/api/marketplace";
import { MarketplaceInstalled } from "./marketplace-installed";
import { ServerBlockBanner, useServerBlock } from "./server-block-context";

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)} M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)} k`;
  return String(count);
}

interface ProjectCardProps {
  project: MarketplaceProject;
  state: AddonState;
  /** Versions proposables : au-delà d'une, un choix est offert. */
  choices: string[];
  /** Décrit ce à quoi le projet devrait convenir, pour le cas incompatible. */
  target: string;
  busy: boolean;
  onInstall: () => void;
  onPickVersion: () => void;
  onRemove: () => void;
}

function ProjectCard({
  project,
  state,
  choices,
  target,
  busy,
  onInstall,
  onPickVersion,
  onRemove,
}: ProjectCardProps) {
  const t = useTranslations("marketplace");
  const tc = useTranslations("common");

  return (
    <Card className="flex flex-col">
      <CardBody className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{project.name}</p>
            <p className="truncate text-xs text-muted">
              {project.author} · {MARKETPLACE_SOURCE_LABEL[project.source]}
            </p>
          </div>
          <Badge variant="neutral">{formatDownloads(project.downloads)}</Badge>
        </div>

        <p className="flex-1 text-sm leading-relaxed text-muted">{project.summary}</p>

        <div className="flex flex-wrap gap-1.5">
          {project.categories.slice(0, 4).map((category) => (
            <Badge key={category} variant="outline">
              {category}
            </Badge>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          {state.kind === "installable" ? (
            <>
              <span className="gd-mono text-xs text-muted">{state.release.version}</span>
              <Button size="sm" disabled={busy} onClick={onInstall}>
                <Download /> {t("install")}
              </Button>
            </>
          ) : state.kind === "up-to-date" ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-success-ink">
                <Check className="size-3.5" /> {t("upToDate")} · {state.installed}
              </span>
              <Button size="sm" variant="danger-ghost" disabled={busy} onClick={onRemove}>
                <Trash2 /> {tc("remove")}
              </Button>
            </>
          ) : state.kind === "update-available" ? (
            <>
              <span className="gd-mono text-xs text-muted">
                {state.installed} →{" "}
                <span className="text-warning-ink">{state.release.version}</span>
              </span>
              <Button size="sm" disabled={busy} onClick={onInstall}>
                <ArrowUpCircle /> {t("update")}
              </Button>
            </>
          ) : state.kind === "download-blocked" ? (
            // Cas réel, pas une anomalie : un auteur peut interdire la
            // distribution par un tiers. Le dire vaut mieux qu'un bouton qui
            // échouerait.
            <span className="flex items-center gap-1.5 text-xs text-warning-ink">
              <Ban className="size-3.5 shrink-0" />
              {t("downloadBlocked")}
            </span>
          ) : state.kind === "installed-incompatible" ? (
            // Survient après une montée de version du jeu : l'extension est
            // toujours là, mais plus aucune publication ne convient. Le
            // signaler, pas le masquer.
            <>
              <span className="flex items-center gap-1.5 text-xs text-danger-ink">
                <TriangleAlert className="size-3.5" /> {t("incompatibleInstalled")} ·{" "}
                {state.installed}
              </span>
              <Button size="sm" variant="danger-ghost" disabled={busy} onClick={onRemove}>
                <Trash2 /> {tc("remove")}
              </Button>
            </>
          ) : (
            <span className="text-xs text-faint">{t("noVersionFor", { target })}</span>
          )}
        </div>

        {/*
         * Choisir une version précise, y compris antérieure : c'est le moyen
         * de revenir en arrière quand une mise à jour casse le serveur.
         */}
        {choices.length > 1 ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onPickVersion}>
            <History /> {t("otherVersion")}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * Catalogue d'extensions d'un serveur.
 *
 * La recherche passe par l'URL et se fait côté serveur : le navigateur
 * n'interroge jamais Modrinth directement. C'est ce qui permet à l'API de
 * décider seule de l'adresse remise au daemon — sans quoi le catalogue
 * deviendrait un moyen de faire télécharger n'importe quoi à un node.
 */
export function MarketplaceWorkspace({
  serverId,
  initial,
  query: initialQuery,
}: {
  serverId: string;
  initial: Catalogue;
  query: string;
}) {
  const t = useTranslations("marketplace");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? initialQuery);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<{ id: string; name: string } | null>(null);
  const [toPick, setToPick] = useState<{ project: MarketplaceProject; choices: string[] } | null>(
    null,
  );
  const [chosen, setChosen] = useState("");
  const [pending, startTransition] = useTransition();
  /*
   * Poser ou retirer une extension revient à écrire dans le conteneur, et
   * c'est vrai de la désinstallation autant que de l'installation. La
   * recherche, elle, interroge le catalogue et non le serveur : elle reste
   * ouverte, parce qu'on peut vouloir préparer ce qu'on installera après.
   */
  const bloc = useServerBlock();

  const run = useCallback(
    (action: () => Promise<{ error: string | null }>) =>
      startTransition(async () => {
        const result = await action();
        setError(result.error);
        if (!result.error) router.refresh();
      }),
    [router],
  );

  const search = () => {
    const next = query.trim();
    router.push(
      `/server/${serverId}/marketplace${next === "" ? "" : `?q=${encodeURIComponent(next)}`}`,
    );
  };

  // Les sources en échec, distinctes de celles qui ont simplement peu rendu.
  const failed = initial.sources.filter((outcome) => outcome.error !== null);

  const target =
    initial.runtime === null
      ? ""
      : [initial.runtime.loader, initial.runtime.gameVersion].filter(Boolean).join(" ");

  return (
    <PageTemplate
      notice={<ServerBlockBanner />}
      header={<PageHeader icon={<Package />} title={t("title")} subtitle={t("subtitle")} />}
      toolbar={
        initial.runtime ? (
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <Input
              className="min-w-64 flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              leadingIcon={<Search />}
            />
            <Button type="submit" variant="secondary" disabled={pending}>
              {tc("search")}
            </Button>
          </form>
        ) : undefined
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {initial.runtime ? (
        <AlertBanner variant="info" title={t("filteredFor", { target })}>
          {t("filteredForBody", { directory: initial.runtime.directory })}
        </AlertBanner>
      ) : (
        <AlertBanner variant="warning" title={t("noCatalogue")}>
          {initial.unavailableReason}
        </AlertBanner>
      )}

      {/*
       * Les sources qui n'ont pas répondu sont nommées, avec leur raison.
       *
       * Sans cela, une clé CurseForge expirée donne exactement le même écran
       * qu'un plugin qui n'existe pas : une liste plus courte. On chercherait
       * le plugin ailleurs, au lieu de réparer la clé.
       */}
      {failed.length > 0 ? (
        <AlertBanner variant="warning" title={t("sourcesDown", { count: failed.length })}>
          <ul className="flex flex-col gap-1">
            {failed.map((outcome) => (
              <li key={outcome.source}>
                <span className="font-semibold">{MARKETPLACE_SOURCE_LABEL[outcome.source]}</span>
                {" — "}
                {outcome.error}
              </li>
            ))}
          </ul>
        </AlertBanner>
      ) : null}

      <MarketplaceInstalled
        installed={initial.installed}
        busy={pending || bloc !== null}
        onUpdate={(item, version) => run(() => installAddon(serverId, item.projectId, version))}
        onUpdateAll={() =>
          run(() =>
            updateAllAddons(
              serverId,
              initial.installed.flatMap((item) =>
                item.latestVersion
                  ? [{ projectId: item.projectId, version: item.latestVersion }]
                  : [],
              ),
            ),
          )
        }
        onRemove={(item) => setToRemove({ id: item.projectId, name: item.name })}
      />

      {initial.entries.length === 0 ? (
        <EmptyState
          icon={<PackageX />}
          title={initial.runtime ? t("noResults") : t("catalogueUnavailable")}
          description={initial.runtime ? t("noResultsHint") : t("catalogueUnavailableHint")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {initial.entries.map(({ project, state, choices }) => (
            <ProjectCard
              key={`${project.source}-${project.id}`}
              project={project}
              state={state}
              choices={choices}
              target={target}
              busy={pending || bloc !== null}
              onInstall={() => run(() => installAddon(serverId, project.id))}
              onPickVersion={() => {
                setChosen(choices[0] ?? "");
                setToPick({ project, choices });
              }}
              onRemove={() => setToRemove(project)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={toPick !== null}
        onOpenChange={(o) => !o && setToPick(null)}
        title={t("pickVersionTitle")}
        description={
          toPick ? (
            <span className="flex flex-col gap-3">
              <span>{t("pickVersionBody", { name: toPick.project.name })}</span>
              <Select
                aria-label={t("pickVersionLabel")}
                value={chosen}
                onChange={(e) => setChosen(e.target.value)}
                options={toPick.choices.map((v) => ({ value: v, label: v }))}
              />
            </span>
          ) : undefined
        }
        confirmLabel={t("install")}
        onConfirm={() => {
          const cible = toPick;
          setToPick(null);
          if (cible && chosen !== "") run(() => installAddon(serverId, cible.project.id, chosen));
        }}
      />

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t("removeTitle")}
        description={toRemove ? t("removeBody", { name: toRemove.name }) : undefined}
        confirmLabel={tc("remove")}
        destructive
        onConfirm={() => {
          const target_ = toRemove;
          setToRemove(null);
          if (target_) run(() => uninstallAddon(serverId, target_.id));
        }}
      />
    </PageTemplate>
  );
}
