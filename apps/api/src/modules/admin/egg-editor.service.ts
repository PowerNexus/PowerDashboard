import {
  EggDraft,
  eggChangeRefusals,
  eggDraftProblems,
  eggProblemMessage,
  eggRefusalMessage,
  exportPterodactylEgg,
  type ParsedEgg,
  type PterodactylEggExport,
} from "@gamedashboard/contracts";
import {
  type Database,
  eggs,
  eggVariables,
  nests,
  servers,
  serverVariables,
} from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { asc, count, eq, inArray } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/** Une variable telle que l'éditeur la montre, avec son emploi. */
export interface EggVariableDetail {
  id: string;
  name: string;
  envVariable: string;
  description: string | null;
  defaultValue: string;
  userViewable: boolean;
  userEditable: boolean;
  rules: string;
  /** Serveurs qui portent une valeur pour elle : non nul, elle ne se retire plus. */
  servers: number;
}

/** L'egg complet, pour l'éditeur. */
export interface EggDetail {
  id: string;
  nest: string;
  name: string;
  description: string | null;
  author: string | null;
  dockerImages: Record<string, string>;
  startup: string;
  configFiles: unknown;
  configStartup: unknown;
  configStop: string | null;
  configLogs: unknown;
  installScript: string;
  installContainer: string;
  installEntrypoint: string;
  features: string[];
  fileDenylist: string[];
  enabled: boolean;
  locallyModified: boolean;
  sourceRef: string | null;
  servers: number;
  variables: EggVariableDetail[];
}

/** Ce qu'un enregistrement a changé, pour le journal et pour l'écran. */
export interface EggUpdateReport {
  detail: EggDetail;
  variablesAdded: string[];
  variablesRemoved: string[];
  /** Valeurs posées sur les serveurs existants pour les variables ajoutées. */
  serverValuesAdded: number;
}

/**
 * Éditeur d'egg : lecture complète, export, enregistrement.
 *
 * Séparé de l'import (`EggImportService`) : l'import **remplace** un egg par
 * un fichier venu d'ailleurs, l'éditeur **modifie** un egg qui fait peut-être
 * déjà tourner des serveurs. Les règles de prudence ne sont pas les mêmes, et
 * les mêler rendrait l'une ou l'autre trop sévère.
 */
@Injectable()
export class EggEditorService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async detail(eggId: string): Promise<EggDetail> {
    const [row] = await this.db
      .select({ egg: eggs, nest: nests.name })
      .from(eggs)
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .where(eq(eggs.id, eggId))
      .limit(1);
    if (!row) throw new NotFoundException("Egg introuvable.");

    const [used] = await this.db
      .select({ n: count() })
      .from(servers)
      .where(eq(servers.eggId, eggId));

    const variables = await this.db
      .select({
        id: eggVariables.id,
        name: eggVariables.name,
        envVariable: eggVariables.envVariable,
        description: eggVariables.description,
        defaultValue: eggVariables.defaultValue,
        userViewable: eggVariables.userViewable,
        userEditable: eggVariables.userEditable,
        rules: eggVariables.rules,
        servers: count(serverVariables.id),
      })
      .from(eggVariables)
      .leftJoin(serverVariables, eq(serverVariables.eggVariableId, eggVariables.id))
      .where(eq(eggVariables.eggId, eggId))
      .groupBy(eggVariables.id)
      // L'ordre de création : c'est celui de l'auteur de l'egg, et celui
      // dans lequel le client verra les champs.
      .orderBy(asc(eggVariables.createdAt), asc(eggVariables.envVariable));

    const { egg } = row;
    return {
      id: egg.id,
      nest: row.nest,
      name: egg.name,
      description: egg.description,
      author: egg.author,
      dockerImages: (egg.dockerImages ?? {}) as Record<string, string>,
      startup: egg.startup,
      configFiles: egg.configFiles,
      configStartup: egg.configStartup,
      configStop: egg.configStop,
      configLogs: egg.configLogs,
      installScript: egg.installScript,
      installContainer: egg.installContainer,
      installEntrypoint: egg.installEntrypoint,
      features: egg.features,
      fileDenylist: egg.fileDenylist,
      enabled: egg.enabled,
      locallyModified: egg.locallyModified,
      sourceRef: egg.sourceRef,
      servers: used?.n ?? 0,
      variables,
    };
  }

  /**
   * L'egg au format d'import Pterodactyl.
   *
   * Construit depuis la même lecture que l'éditeur, puis traduit par
   * `exportPterodactylEgg` : le format vit dans `contracts`, à côté du lecteur
   * qui doit pouvoir le relire.
   */
  async export(eggId: string): Promise<{ filename: string; egg: PterodactylEggExport }> {
    const detail = await this.detail(eggId);
    const parsed: ParsedEgg = {
      name: detail.name,
      description: detail.description,
      author: detail.author,
      dockerImages: detail.dockerImages,
      startup: detail.startup,
      configFiles: detail.configFiles,
      configStartup: detail.configStartup,
      configStop: detail.configStop,
      configLogs: detail.configLogs,
      installScript: detail.installScript,
      installContainer: detail.installContainer,
      installEntrypoint: detail.installEntrypoint,
      features: detail.features,
      fileDenylist: detail.fileDenylist,
      variables: detail.variables.map((variable) => ({
        name: variable.name,
        envVariable: variable.envVariable,
        description: variable.description,
        defaultValue: variable.defaultValue,
        userViewable: variable.userViewable,
        userEditable: variable.userEditable,
        rules: variable.rules,
      })),
    };

    // Le nom de fichier de Pterodactyl : `egg-<nom>.json`, en minuscules.
    const slug = detail.name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return { filename: `egg-${slug || "export"}.json`, egg: exportPterodactylEgg(parsed) };
  }

  /**
   * Enregistre l'egg modifié.
   *
   * Tout se passe dans **une** transaction, lectures comprises : les refus
   * portent sur les valeurs des serveurs, et un serveur créé entre la
   * vérification et l'écriture recevrait sinon une variable qu'on vient de
   * juger sûre sans lui.
   *
   * L'egg est marqué `locallyModified` : la synchronisation de son dépôt
   * d'origine cesse alors de l'écraser (§8.3). Sans cette marque, la
   * prochaine synchronisation effacerait silencieusement ce qu'on vient
   * d'enregistrer.
   */
  async update(eggId: string, input: unknown): Promise<EggUpdateReport> {
    const problems = eggDraftProblems(input);
    if (problems.length > 0) {
      throw new BadRequestException(problems.map(eggProblemMessage).join(" ; "));
    }
    const draft = EggDraft.parse(input);

    const report = await this.db.transaction(async (tx) => {
      const [egg] = await tx
        .select({ id: eggs.id })
        .from(eggs)
        .where(eq(eggs.id, eggId))
        .for("update");
      if (!egg) throw new NotFoundException("Egg introuvable.");

      const eggServers = await tx
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.eggId, eggId));

      const stored = await tx
        .select({
          id: eggVariables.id,
          envVariable: eggVariables.envVariable,
          rules: eggVariables.rules,
          defaultValue: eggVariables.defaultValue,
        })
        .from(eggVariables)
        .where(eq(eggVariables.eggId, eggId));

      const values =
        stored.length === 0
          ? []
          : await tx
              .select({ variableId: serverVariables.eggVariableId, value: serverVariables.value })
              .from(serverVariables)
              .where(
                inArray(
                  serverVariables.eggVariableId,
                  stored.map((variable) => variable.id),
                ),
              );

      const withValues = stored.map((variable) => ({
        ...variable,
        serverValues: values
          .filter((entry) => entry.variableId === variable.id)
          .map((entry) => entry.value),
      }));

      const refusals = eggChangeRefusals(withValues, draft.variables, eggServers.length);
      if (refusals.length > 0) {
        throw new ConflictException(refusals.map(eggRefusalMessage).join(" "));
      }

      await tx
        .update(eggs)
        .set({
          name: draft.name,
          description: draft.description.trim() || null,
          author: draft.author || null,
          dockerImages: Object.fromEntries(
            draft.dockerImages.map((entry) => [entry.label, entry.image]),
          ),
          startup: draft.startup,
          configStop: draft.configStop || null,
          configStartup: jsonBlock(draft.configStartup),
          configFiles: jsonBlock(draft.configFiles),
          configLogs: jsonBlock(draft.configLogs),
          installContainer: draft.installContainer,
          installEntrypoint: draft.installEntrypoint,
          installScript: draft.installScript,
          features: draft.features,
          fileDenylist: draft.fileDenylist,
          locallyModified: true,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(eggs.id, eggId));

      const kept = new Set(
        draft.variables.flatMap((variable) => (variable.id ? [variable.id] : [])),
      );
      const removed = stored.filter((variable) => !kept.has(variable.id));
      if (removed.length > 0) {
        // `eggChangeRefusals` a déjà écarté toute variable employée : ce qui
        // reste ici n'a aucune valeur sur aucun serveur.
        await tx.delete(eggVariables).where(
          inArray(
            eggVariables.id,
            removed.map((variable) => variable.id),
          ),
        );
      }

      /*
       * Les renommages passent d'abord par un nom provisoire.
       *
       * La base interdit deux variables du même nom sur un egg ; échanger deux
       * noms en une passe violerait la contrainte à mi-chemin, alors que l'état
       * final est parfaitement valide.
       */
      const byId = new Map(stored.map((variable) => [variable.id, variable]));
      for (const variable of draft.variables) {
        const before = variable.id ? byId.get(variable.id) : undefined;
        if (before && before.envVariable !== variable.envVariable) {
          await tx
            .update(eggVariables)
            .set({ envVariable: `__renommage_${before.id.replace(/-/g, "").slice(0, 16)}` })
            .where(eq(eggVariables.id, before.id));
        }
      }

      const added: string[] = [];
      let serverValuesAdded = 0;
      for (const variable of draft.variables) {
        const fields = {
          name: variable.name,
          envVariable: variable.envVariable,
          description: variable.description.trim() || null,
          defaultValue: variable.defaultValue,
          userViewable: variable.userViewable,
          userEditable: variable.userEditable,
          rules: variable.rules,
          updatedAt: new Date().toISOString(),
        };

        if (variable.id) {
          await tx.update(eggVariables).set(fields).where(eq(eggVariables.id, variable.id));
          continue;
        }

        const [created] = await tx
          .insert(eggVariables)
          .values({ eggId, ...fields })
          .returning({ id: eggVariables.id });
        if (!created) throw new Error(`La variable « ${variable.envVariable} » n'a pas été créée.`);
        added.push(variable.envVariable);

        /*
         * Une variable ajoutée reçoit sa valeur par défaut **sur chaque serveur
         * existant**.
         *
         * L'environnement envoyé à Wings ne contient que les variables qui ont
         * une valeur en base pour le serveur (`environmentFor`). Sans cette
         * ligne, un serveur créé avant l'ajout démarrerait avec `{{VAR}}`
         * littéral dans sa commande, et son propriétaire ne verrait pas le
         * champ qui permettrait de le corriger.
         */
        if (eggServers.length > 0) {
          await tx
            .insert(serverVariables)
            .values(
              eggServers.map((server) => ({
                serverId: server.id,
                eggVariableId: created.id,
                value: variable.defaultValue,
              })),
            )
            .onConflictDoNothing();
          serverValuesAdded += eggServers.length;
        }
      }

      return {
        variablesAdded: added,
        variablesRemoved: removed.map((variable) => variable.envVariable),
        serverValuesAdded,
      };
    });

    return { ...report, detail: await this.detail(eggId) };
  }
}

/** Un bloc saisi en texte, relu en objet. Vide vaut `{}`, comme à l'import. */
function jsonBlock(text: string): unknown {
  return text.trim() === "" ? {} : JSON.parse(text);
}
