"use client";

import {
  acceptsExplicitResources,
  choosesOwner,
  type ResourceRequest,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  formatMb,
  Input,
  KeyValueGrid,
  OptionCard,
  PageHeader,
  PageTemplate,
  SelectMenu,
  Wizard,
  type WizardStep,
} from "@gamedashboard/ui";
import { Gamepad2, Globe, HardDrive, Rocket, Server, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import { ResourceFields } from "@/components/resource-fields";
import { type Catalogue, createServer } from "@/server/api/catalogue";

/** Compte auquel un administrateur peut attribuer le serveur. */
export interface OwnerOption {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Faux pour un revendeur qui n'autorise pas l'administration à provisionner. */
  provisionable: boolean;
}

/**
 * Assistant de création.
 *
 * Trois façons de remplir le même formulaire, décidées par `catalogue.mode`,
 * que l'**API** calcule d'après le rôle. L'écran ne le choisit pas et ne peut
 * pas s'en écarter : forcer un mode ici ne ferait que produire une requête que
 * l'API refuserait.
 *
 * - **guidé** (client) : offres toutes faites, localisation. Le panel place le
 *   serveur, et aucune quantité ne transite par le navigateur.
 * - **assisté** (revendeur) : un gabarit puis des quantités ajustables, sur
 *   ses nodes et dans les limites de ce qu'il y reste.
 * - **avancé** (administrateur) : tout est libre, y compris le node et le
 *   compte destinataire.
 */
export function CreateServerWizard({
  catalogue,
  owners = [],
  selfId,
}: {
  catalogue: Catalogue;
  /** Comptes proposés en mode avancé. Vide ailleurs. */
  owners?: OwnerOption[];
  selfId: string;
}) {
  const t = useTranslations("createServer");
  const tc = useTranslations("common");
  const router = useRouter();
  const [eggId, setEggId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const explicit = acceptsExplicitResources(catalogue.mode);
  const withOwner = choosesOwner(catalogue.mode);

  /**
   * Node retenu.
   *
   * Pré-sélectionné quand il n'y en a qu'un utilisable : un revendeur qui ne
   * possède qu'une machine n'a rien à choisir, et lui présenter une liste d'un
   * seul élément serait une étape pour rien.
   */
  const usable = useMemo(
    () => catalogue.nodes.filter((node) => !node.maintenanceMode && node.freePorts > 0),
    [catalogue.nodes],
  );
  const [nodeId, setNodeId] = useState<string | null>(
    usable.length === 1 ? (usable[0]?.id ?? null) : null,
  );
  const [ownerId, setOwnerId] = useState<string>(selfId);

  const node = useMemo(
    () => catalogue.nodes.find((n) => n.id === nodeId) ?? null,
    [catalogue.nodes, nodeId],
  );

  const [resources, setResources] = useState<ResourceRequest>({
    memoryMb: 4096,
    diskMb: 25_600,
    cpuPct: 200,
    swapMb: 0,
    allocations: 1,
    backups: 5,
    databases: 2,
  });

  const game = catalogue.games.find((g) => g.eggId === eggId) ?? null;
  const plan = catalogue.plans.find((p) => p.id === planId) ?? null;
  const location = catalogue.locations.find((l) => l.id === locationId) ?? null;
  const owner = owners.find((o) => o.id === ownerId) ?? null;

  /** Un plan sous la mémoire minimale du jeu est proposé mais désactivé. */
  const planTooSmall = useCallback(
    (memoryMb: number) => (game ? memoryMb < game.minMemoryMb : false),
    [game],
  );

  /** Changer de jeu réinitialise les variables et invalide un plan trop petit. */
  const selectGame = useCallback(
    (id: string) => {
      const next = catalogue.games.find((x) => x.eggId === id);
      setEggId(id);
      setVariables(
        Object.fromEntries((next?.variables ?? []).map((v) => [v.envVariable, v.defaultValue])),
      );
      setPlanId((current) => {
        const chosen = catalogue.plans.find((p) => p.id === current);
        if (!chosen || !next) return current;
        return chosen.memoryMb < next.minMemoryMb ? null : current;
      });
    },
    [catalogue.games, catalogue.plans],
  );

  const gameStep: WizardStep = {
    id: "game",
    title: t("stepGame"),
    description: t("stepGameHint"),
    isComplete: eggId !== null,
    content: (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {catalogue.games.map((g) => (
            <OptionCard
              key={g.eggId}
              icon={<Gamepad2 />}
              title={g.name}
              description={g.description ?? g.nest}
              meta={`≥ ${formatMb(g.minMemoryMb, 0)}`}
              selected={eggId === g.eggId}
              onSelect={() => selectGame(g.eggId)}
            />
          ))}
        </div>
        {/* Les variables proposées sont celles que l'egg déclare modifiables
            par le client. Les autres — mots de passe RCON, clés d'API — sont
            renseignées par le panel et n'apparaissent pas ici. */}
        {game && game.variables.length > 0 ? (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            {game.variables.map((variable) => (
              <FormField
                key={variable.envVariable}
                label={variable.name}
                description={variable.description ?? variable.envVariable}
              >
                {(id) => (
                  <Input
                    id={id}
                    className="gd-mono sm:max-w-xs"
                    value={variables[variable.envVariable] ?? variable.defaultValue}
                    onChange={(e) =>
                      setVariables((current) => ({
                        ...current,
                        [variable.envVariable]: e.target.value,
                      }))
                    }
                  />
                )}
              </FormField>
            ))}
          </div>
        ) : null}
      </div>
    ),
  };

  /** Mode guidé : offres toutes faites. */
  const planStep: WizardStep = {
    id: "plan",
    title: t("stepPlan"),
    description: t("stepPlanHint"),
    isComplete: planId !== null,
    content: (
      <div className="flex flex-col gap-4">
        {game ? (
          <AlertBanner variant="info">
            {t("minMemory", { game: game.name, memory: formatMb(game.minMemoryMb, 0) })}
          </AlertBanner>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {catalogue.plans.map((p) => (
            <OptionCard
              key={p.id}
              icon={<HardDrive />}
              title={p.name}
              description={t("planDetails", {
                memory: formatMb(p.memoryMb, 0),
                disk: formatMb(p.diskMb, 0),
                cpu: p.cpuPct,
                backups: p.backups,
              })}
              meta={p.priceLabel}
              disabled={planTooSmall(p.memoryMb)}
              selected={planId === p.id}
              onSelect={() => setPlanId(p.id)}
            />
          ))}
        </div>
      </div>
    ),
  };

  /** Mode guidé : le panel place le serveur, le client choisit la région. */
  const locationStep: WizardStep = {
    id: "location",
    title: t("stepLocation"),
    description: t("stepLocationHint"),
    isComplete: locationId !== null,
    content: (
      <div className="grid gap-3 sm:grid-cols-2">
        {catalogue.locations.map((l) => (
          <OptionCard
            key={l.id}
            icon={<Globe />}
            title={l.long}
            // « Complet » et « indisponible » ne sont pas la même chose :
            // le premier se résout en attendant, le second se règle avec
            // le support.
            description={
              l.isAvailable
                ? `${l.short} · ${t("freePorts", { count: l.availablePorts })}`
                : `${l.short} · ${t("full")}`
            }
            disabled={!l.isAvailable}
            selected={locationId === l.id}
            onSelect={() => setLocationId(l.id)}
          />
        ))}
      </div>
    ),
  };

  /** Modes assisté et avancé : le node est désigné, pas déduit. */
  const nodeStep: WizardStep = {
    id: "node",
    title: t("stepNode"),
    description: catalogue.mode === "advanced" ? t("stepNodeHintAdmin") : t("stepNodeHintReseller"),
    isComplete: nodeId !== null,
    content:
      catalogue.nodes.length === 0 ? (
        <EmptyState icon={<Server />} title={t("noNodes")} description={t("noNodesHint")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {catalogue.nodes.map((n) => (
            <OptionCard
              key={n.id}
              icon={<Server />}
              title={n.name}
              description={
                n.maintenanceMode
                  ? t("nodeInMaintenance")
                  : t("nodeCapacity", {
                      memory: formatMb(n.freeMemoryMb, 0),
                      disk: formatMb(n.freeDiskMb, 0),
                      ports: n.freePorts,
                    })
              }
              // L'appartenance n'est montrée qu'à l'administrateur : un
              // revendeur ne voit que ses nodes, le lui répéter n'apprend rien.
              meta={
                catalogue.mode === "advanced"
                  ? `${n.locationShort} · ${n.ownerId ? t("nodeReseller") : t("nodePlatform")}`
                  : n.locationShort
              }
              disabled={n.maintenanceMode || n.freePorts === 0}
              selected={nodeId === n.id}
              onSelect={() => setNodeId(n.id)}
            />
          ))}
        </div>
      ),
  };

  /** Modes assisté et avancé : les quantités, à la main. */
  const resourceStep: WizardStep = {
    id: "resources",
    title: t("stepResources"),
    description:
      catalogue.mode === "advanced" ? t("stepResourcesHintAdmin") : t("stepResourcesHintReseller"),
    isComplete: resources.memoryMb > 0 && resources.diskMb > 0,
    content: (
      <div className="flex flex-col gap-5">
        {/* Les gabarits ne sont proposés qu'en mode assisté : ils sont l'aide
            qui distingue « guidé mais avancé » de « tout libre ». */}
        {catalogue.mode === "assisted" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-fg">{t("presets")}</p>
            <p className="text-xs text-muted">{t("presetsHint")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {catalogue.plans.map((p) => (
                <OptionCard
                  key={p.id}
                  icon={<SlidersHorizontal />}
                  title={p.name}
                  description={t("planDetails", {
                    memory: formatMb(p.memoryMb, 0),
                    disk: formatMb(p.diskMb, 0),
                    cpu: p.cpuPct,
                    backups: p.backups,
                  })}
                  selected={false}
                  onSelect={() =>
                    setResources({
                      memoryMb: p.memoryMb,
                      diskMb: p.diskMb,
                      cpuPct: p.cpuPct,
                      swapMb: p.swapMb,
                      allocations: p.allocations,
                      backups: p.backups,
                      databases: p.databases,
                    })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        <ResourceFields
          value={resources}
          onChange={setResources}
          node={node}
          quota={catalogue.quota}
        />
      </div>
    ),
  };

  const finalStep: WizardStep = {
    id: "options",
    title: t("stepFinal"),
    description: t("stepFinalHint"),
    isComplete: name.trim().length > 0,
    content: (
      <div className="flex flex-col gap-5">
        <FormField label={t("nameLabel")} description={t("nameHint")}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
            />
          )}
        </FormField>

        {/*
          Le compte destinataire n'est proposé qu'à l'administrateur. Les
          revendeurs qui n'autorisent pas l'administration à provisionner sont
          grisés plutôt que masqués : les faire disparaître donnerait
          l'impression qu'ils n'existent pas, alors qu'ils ont simplement dit
          non. L'API refuse de toute façon.
        */}
        {withOwner ? (
          <FormField label={t("ownerLabel")} description={t("ownerHint")}>
            {(id) => (
              <SelectMenu
                id={id}
                value={ownerId}
                onValueChange={setOwnerId}
                options={owners.map((o) => ({
                  value: o.id,
                  label: o.id === selfId ? t("ownerSelf", { name: o.name }) : o.name,
                  description: o.provisionable ? o.email : t("ownerRefuses"),
                  disabled: !o.provisionable,
                }))}
              />
            )}
          </FormField>
        ) : null}

        <AlertBanner variant="info" title={t("afterCreation")}>
          {t("afterCreationBody")}
        </AlertBanner>
      </div>
    ),
  };

  const steps = explicit
    ? [gameStep, nodeStep, resourceStep, finalStep]
    : [gameStep, planStep, locationStep, finalStep];

  // Aucun jeu activé : l'assistant n'a rien à proposer, et le dire vaut mieux
  // qu'un premier écran vide où l'on cherche ce qu'on a mal fait.
  if (catalogue.games.length === 0) {
    return (
      <PageTemplate
        header={
          <PageHeader
            icon={<Rocket />}
            title={t("title")}
            breadcrumbs={[
              { label: t("myServers"), href: "/servers" },
              { label: t("breadcrumbNew") },
            ]}
          />
        }
      >
        <EmptyState icon={<Gamepad2 />} title={t("noGames")} description={t("noGamesHint")} />
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Rocket />}
          title={t("title")}
          subtitle={explicit ? t("subtitleAdvanced") : t("subtitle")}
          breadcrumbs={[{ label: t("myServers"), href: "/servers" }, { label: t("breadcrumbNew") }]}
        />
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={t("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      <Wizard
        steps={steps}
        finishLabel={pending ? t("submitting") : t("submit")}
        onFinish={() =>
          startTransition(async () => {
            if (!eggId) return;
            if (explicit ? !nodeId : !(planId && locationId)) return;

            const result = await createServer({
              eggId,
              name: name.trim(),
              variables,
              ...(explicit
                ? {
                    nodeId: nodeId ?? undefined,
                    resources,
                    ownerId: withOwner ? ownerId : undefined,
                  }
                : { planId: planId ?? undefined, locationId: locationId ?? undefined }),
            });
            setError(result.error);
            // On ne navigue qu'après confirmation : renvoyer vers la liste sur
            // un échec ferait chercher un serveur qui n'a jamais été créé.
            if (result.id) router.push(`/server/${result.id}`);
          })
        }
        aside={
          <Card>
            <CardHeader title={t("summary")} description={t("summaryHint")} />
            <CardBody>
              <KeyValueGrid
                columns={1}
                items={[
                  { label: t("stepGame"), value: game?.name ?? tc("none") },
                  ...(explicit
                    ? [
                        { label: t("stepNode"), value: node?.name ?? tc("none") },
                        { label: t("memory"), value: formatMb(resources.memoryMb, 0) },
                        { label: tc("disk"), value: formatMb(resources.diskMb, 0) },
                        {
                          label: t("fieldCpu"),
                          value: resources.cpuPct === 0 ? t("unlimited") : `${resources.cpuPct} %`,
                        },
                        { label: t("backups"), value: String(resources.backups) },
                        { label: t("fieldAllocations"), value: String(resources.allocations) },
                      ]
                    : [
                        { label: t("plan"), value: plan?.name ?? tc("none") },
                        {
                          label: t("memory"),
                          value: plan ? formatMb(plan.memoryMb, 0) : tc("none"),
                        },
                        { label: tc("disk"), value: plan ? formatMb(plan.diskMb, 0) : tc("none") },
                        { label: t("backups"), value: plan ? String(plan.backups) : tc("none") },
                        { label: tc("location"), value: location?.long ?? tc("none") },
                      ]),
                  ...(withOwner
                    ? [{ label: t("ownerLabel"), value: owner?.name ?? tc("none") }]
                    : []),
                  { label: tc("name"), value: name.trim() || tc("none") },
                ]}
              />
            </CardBody>
          </Card>
        }
      />
    </PageTemplate>
  );
}
