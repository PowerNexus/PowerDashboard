import { EggParseError, type ParsedEgg, parsePterodactylEgg } from "@gamedashboard/contracts";
import { type Database, eggSources, eggs, eggVariables, nests } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Entrée du catalogue : import d'eggs Pterodactyl.
 *
 * Deux chemins, parce que deux besoins différents :
 *
 * - **coller un fichier**, pour l'egg qu'on a écrit ou récupéré à la main ;
 * - **synchroniser un dépôt**, pour le catalogue officiel, qui compte plus de
 *   deux cents eggs et continue de bouger.
 *
 * Les deux aboutissent au même endroit et respectent la même règle : un egg
 * édité localement n'est **jamais** écrasé par une synchronisation. Le dépôt
 * amont ne connaît ni les images qu'on a épinglées, ni les variables qu'on a
 * verrouillées ; écraser reviendrait à défaire ce travail à chaque passage,
 * silencieusement, sur des eggs qui font tourner des serveurs en production.
 */

/** Ce qu'une opération d'import a réellement fait. */
export interface EggImportReport {
  created: number;
  updated: number;
  /** Eggs édités localement, laissés tels quels. */
  skippedLocallyModified: number;
  /** Fichiers refusés, avec la raison — un fichier illisible ne doit pas être tu. */
  failed: { ref: string; reason: string }[];
}

/**
 * Au-delà, on cesse de lire un dépôt.
 *
 * Aucun catalogue légitime n'approche ce chiffre ; il borne le cas où l'on
 * pointe par erreur un dépôt entier plutôt qu'un dossier d'eggs.
 */
const MAX_FILES_PER_SYNC = 600;

/** Un fichier d'egg dépassant cette taille n'en est pas un. */
const MAX_EGG_BYTES = 512 * 1024;

/** Durée de validité de l'arbre d'un dépôt gardé en mémoire. */
const TREE_CACHE_TTL_MS = 15 * 60_000;

/** Ce qu'un dépôt propose, tel que l'écran de recherche l'affiche. */
export interface EggCatalogueEntry {
  /** Chemin dans le dépôt : c'est lui qu'on renvoie pour importer. */
  path: string;
  name: string;
  /** Rangement déduit du chemin, pour regrouper les résultats. */
  group: string;
  /** Identifiant local si l'egg est déjà importé, `null` sinon. */
  installedId: string | null;
  enabled: boolean;
}

/**
 * Le nom d'un egg, deviné depuis son chemin.
 *
 * `minecraft/java/paper/egg-paper.json` donne « Paper ». C'est une approximation
 * assumée : elle sert à **chercher**, pas à nommer. Le vrai nom, celui que le
 * fichier déclare, remplace celui-ci dès l'import.
 */
function nameFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  const base = file.replace(/\.json$/i, "").replace(/^egg-/i, "");
  const source =
    base === "" || /^(config|conf|settings)$/i.test(base) ? (path.split("/").at(-2) ?? base) : base;

  return source
    .replace(/[_-]+/g, " ")
    .replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase())
    .trim();
}

/** Le chemin des dossiers, pour regrouper la liste de recherche. */
function groupFromPath(path: string): string {
  const parts = path.split("/").slice(0, -1);
  if (parts.length === 0) return "Racine";
  return parts
    .map((part) =>
      part.replace(/[_-]+/g, " ").replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase()),
    )
    .join(" / ");
}

@Injectable()
export class EggImportService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /* --- Sources ------------------------------------------------------------ */

  async listSources() {
    return this.db.select().from(eggSources).orderBy(eggSources.name);
  }

  async addSource(input: {
    name: string;
    url: string;
    branch?: string;
    pathGlob?: string;
  }): Promise<{ id: string }> {
    const name = input.name.trim();
    const url = input.url.trim();
    if (!name) throw new BadRequestException("Nommez la source : c'est ce qui l'identifiera.");

    /*
     * Seul GitHub est accepté, et seulement en HTTPS.
     *
     * Ce n'est pas une préférence : la synchronisation lit l'arbre d'un dépôt
     * par l'API de GitHub, dont la forme est propre à GitHub. Accepter une
     * autre adresse produirait un échec au premier passage, longtemps après
     * qu'on l'a saisie — mieux vaut refuser ici, où l'on sait encore pourquoi.
     */
    const repo = parseGitHubRepo(url);
    if (!repo) {
      throw new BadRequestException(
        "Adresse attendue : un dépôt GitHub, par exemple https://github.com/pterodactyl/game-eggs.",
      );
    }

    /*
     * La branche est **demandée à GitHub** quand on n'en donne pas.
     *
     * Un défaut codé en dur se trompe : `pterodactyl/game-eggs` publie sur
     * `main`, d'autres dépôts sur `master`, et la convention a changé en cours
     * de route. Une valeur devinée produit un « dépôt introuvable » au premier
     * passage, pour un dépôt qui existe — le pire message possible, parce
     * qu'il désigne le mauvais coupable.
     */
    const branch = input.branch?.trim() || (await defaultBranchOf(repo));

    const [row] = await this.db
      .insert(eggSources)
      .values({
        name,
        type: "git",
        url: `https://github.com/${repo.owner}/${repo.name}`,
        branch,
        pathGlob: input.pathGlob?.trim() || "**/*.json",
      })
      .returning({ id: eggSources.id });

    // Un insert qui ne rend rien est une invariante rompue, pas un cas nominal.
    if (!row) throw new Error("La source n'a pas pu être créée.");
    return { id: row.id };
  }

  async removeSource(sourceId: string): Promise<void> {
    // Les eggs déjà importés restent : leur `source_id` passe à null (la
    // contrainte est en `set null`). Supprimer une source ne doit pas emporter
    // des eggs dont dépendent des serveurs en service.
    await this.db.delete(eggSources).where(eq(eggSources.id, sourceId));
  }

  /* --- Catalogue d'un dépôt ----------------------------------------------- */

  /**
   * Ce qu'un dépôt propose, sans rien importer.
   *
   * L'écran d'administration cherche un jeu précis — « je veux Palworld » — et
   * non « je veux les deux cent cinquante ». Lister d'abord permet de choisir ;
   * synchroniser tout reste possible, mais devient le geste rare qu'il est.
   *
   * Le nom vient du **chemin**, pas du contenu : lire deux cent soixante
   * fichiers pour afficher une liste coûterait une minute et deux cent soixante
   * requêtes. Le vrai nom, celui que l'egg déclare, remplace celui-ci au moment
   * de l'import.
   */
  async catalogue(sourceId: string): Promise<EggCatalogueEntry[]> {
    const [source] = await this.db.select().from(eggSources).where(eq(eggSources.id, sourceId));
    if (!source) throw new NotFoundException("Source inconnue.");

    const repo = parseGitHubRepo(source.url);
    if (!repo)
      throw new BadRequestException("L'adresse de cette source n'est pas un dépôt GitHub.");

    const paths = await this.treeOf(repo, source.branch);

    // Ce qui est déjà importé depuis cette source, pour que l'écran puisse le
    // dire plutôt que de proposer un import qui ne ferait que réécrire.
    const installed = await this.db
      .select({ ref: eggs.sourceRef, id: eggs.id, name: eggs.name, enabled: eggs.enabled })
      .from(eggs)
      .where(eq(eggs.sourceId, source.id));

    const byRef = new Map(installed.map((row) => [row.ref, row]));

    return paths.map((path) => {
      const existing = byRef.get(path);
      return {
        path,
        name: existing?.name ?? nameFromPath(path),
        group: groupFromPath(path),
        installedId: existing?.id ?? null,
        enabled: existing?.enabled ?? false,
      };
    });
  }

  /**
   * Importe **un** fichier d'un dépôt suivi.
   *
   * Le chemin est relu dans l'arbre du dépôt avant d'être demandé : sans cette
   * vérification, le champ deviendrait un moyen de faire télécharger au serveur
   * n'importe quel fichier du dépôt — et, avec un `..`, d'ailleurs.
   */
  async importFromSource(sourceId: string, path: string): Promise<{ id: string; name: string }> {
    const [source] = await this.db.select().from(eggSources).where(eq(eggSources.id, sourceId));
    if (!source) throw new NotFoundException("Source inconnue.");

    const repo = parseGitHubRepo(source.url);
    if (!repo)
      throw new BadRequestException("L'adresse de cette source n'est pas un dépôt GitHub.");

    const paths = await this.treeOf(repo, source.branch);
    if (!paths.includes(path)) {
      throw new BadRequestException("Ce fichier ne figure pas dans le dépôt.");
    }

    const raw = await fetchJson<unknown>(
      `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${source.branch}/${path}`,
    );

    let parsed: ParsedEgg;
    try {
      parsed = parsePterodactylEgg(raw);
    } catch (error) {
      if (error instanceof EggParseError) throw new BadRequestException(error.message);
      throw error;
    }

    const nestId = await this.ensureNest(nestNameFromPath(path));
    const { id } = await this.upsertEgg(parsed, {
      nestId,
      sourceId: source.id,
      sourceRef: path,
    });

    return { id, name: parsed.name };
  }

  /**
   * Le dépôt officiel, créé au besoin.
   *
   * L'écran ne demande plus d'ajouter une source avant de chercher un egg :
   * c'était une étape de configuration pour un besoin qui n'en a pas. Elle est
   * posée à la première ouverture, et reste modifiable.
   */
  async defaultSource(): Promise<{ id: string; name: string; url: string; branch: string }> {
    const [existing] = await this.db
      .select()
      .from(eggSources)
      .orderBy(eggSources.createdAt)
      .limit(1);
    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        url: existing.url,
        branch: existing.branch,
      };
    }

    const { id } = await this.addSource({
      name: "Pterodactyl game-eggs",
      url: "https://github.com/pterodactyl/game-eggs",
    });

    const [created] = await this.db.select().from(eggSources).where(eq(eggSources.id, id));
    if (!created) throw new Error("La source par défaut n'a pas pu être créée.");
    return { id: created.id, name: created.name, url: created.url, branch: created.branch };
  }

  /**
   * L'arbre du dépôt, gardé en mémoire un quart d'heure.
   *
   * L'API de GitHub n'accorde que soixante appels par heure sans jeton. Chaque
   * frappe dans le champ de recherche ne doit pas en consommer un : la liste
   * est filtrée côté écran, et le dépôt n'est relu que lorsqu'elle a vieilli.
   */
  private async treeOf(repo: { owner: string; name: string }, branch: string): Promise<string[]> {
    const key = `${repo.owner}/${repo.name}@${branch}`;
    const cached = EggImportService.trees.get(key);
    if (cached && Date.now() - cached.at < TREE_CACHE_TTL_MS) return cached.paths;

    const tree = await fetchJson<{
      tree?: { path: string; type: string; size?: number }[];
    }>(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );

    const paths = (tree.tree ?? [])
      .filter((entry) => entry.type === "blob" && entry.path.endsWith(".json"))
      .filter((entry) => (entry.size ?? 0) <= MAX_EGG_BYTES)
      .map((entry) => entry.path)
      .slice(0, MAX_FILES_PER_SYNC);

    EggImportService.trees.set(key, { at: Date.now(), paths });
    return paths;
  }

  /** Partagé par toutes les instances : il n'y en a qu'une, et c'est un cache. */
  private static readonly trees = new Map<string, { at: number; paths: string[] }>();

  /* --- Import d'un fichier ------------------------------------------------ */

  /**
   * Importe un export d'egg collé ou téléversé.
   *
   * `nestName` range l'egg dans une famille, créée au besoin : sans famille,
   * l'egg n'apparaîtrait nulle part dans le catalogue, la table portant une
   * clé étrangère obligatoire.
   */
  async importOne(input: { json: unknown; nestName?: string }): Promise<{ id: string }> {
    // Même borne qu'un fichier tiré d'un dépôt : un egg collé ne pèse pas plus.
    let bytes: number;
    try {
      bytes = JSON.stringify(input.json ?? null).length;
    } catch {
      throw new BadRequestException("JSON d'egg illisible.");
    }
    if (bytes > MAX_EGG_BYTES) {
      throw new BadRequestException(`Egg trop volumineux : ${MAX_EGG_BYTES} octets au plus.`);
    }

    let parsed: ParsedEgg;
    try {
      parsed = parsePterodactylEgg(input.json);
    } catch (error) {
      if (error instanceof EggParseError) throw new BadRequestException(error.message);
      throw error;
    }

    const nestId = await this.ensureNest(input.nestName?.trim() || "Importés");
    const { id } = await this.upsertEgg(parsed, {
      nestId,
      sourceId: null,
      sourceRef: null,
    });
    return { id };
  }

  /* --- Synchronisation d'un dépôt ----------------------------------------- */

  /**
   * Relit un dépôt et met le catalogue à jour.
   *
   * L'arbre complet est demandé en une requête plutôt que dossier par dossier :
   * l'API de GitHub limite à soixante appels par heure sans jeton, et parcourir
   * `game-eggs` répertoire par répertoire épuiserait ce budget avant d'avoir
   * lu un seul egg.
   */
  async syncSource(sourceId: string): Promise<EggImportReport> {
    const [source] = await this.db.select().from(eggSources).where(eq(eggSources.id, sourceId));
    if (!source) throw new NotFoundException("Source inconnue.");

    const repo = parseGitHubRepo(source.url);
    if (!repo)
      throw new BadRequestException("L'adresse de cette source n'est pas un dépôt GitHub.");

    const tree = await fetchJson<{
      sha: string;
      truncated?: boolean;
      tree?: { path: string; type: string; size?: number }[];
    }>(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(source.branch)}?recursive=1`,
    );

    const candidates = (tree.tree ?? [])
      .filter((entry) => entry.type === "blob" && entry.path.endsWith(".json"))
      .filter((entry) => (entry.size ?? 0) <= MAX_EGG_BYTES)
      .slice(0, MAX_FILES_PER_SYNC);

    if (candidates.length === 0) {
      throw new BadRequestException(
        `Aucun fichier .json sur la branche « ${source.branch} ». Vérifiez le nom de la branche.`,
      );
    }

    const report: EggImportReport = {
      created: 0,
      updated: 0,
      skippedLocallyModified: 0,
      failed: [],
    };

    for (const entry of candidates) {
      try {
        const raw = await fetchJson<unknown>(
          `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${source.branch}/${entry.path}`,
        );
        const parsed = parsePterodactylEgg(raw);

        // La famille vient du premier dossier du chemin : dans `game-eggs`,
        // c'est `minecraft/`, `steam/`, `voice_servers/`… Le dépôt range déjà
        // ses eggs ; réinventer un classement ici s'en écarterait à la
        // première réorganisation amont.
        const nestId = await this.ensureNest(nestNameFromPath(entry.path));

        const outcome = await this.upsertEgg(parsed, {
          nestId,
          sourceId: source.id,
          sourceRef: entry.path,
        });

        if (outcome.outcome === "created") report.created += 1;
        else if (outcome.outcome === "updated") report.updated += 1;
        else report.skippedLocallyModified += 1;
      } catch (error) {
        /*
         * Un fichier fautif n'interrompt pas la synchronisation.
         *
         * `game-eggs` contient aussi des `.json` qui ne sont pas des eggs —
         * métadonnées de dépôt, fichiers de configuration. S'arrêter au
         * premier ferait échouer l'import entier pour un fichier sans rapport.
         * On les compte et on les nomme ; c'est à l'administrateur de juger.
         */
        report.failed.push({
          ref: entry.path,
          reason: error instanceof Error ? error.message : "Erreur inconnue.",
        });
      }
    }

    await this.db
      .update(eggSources)
      .set({ lastSyncedRef: tree.sha, lastSyncedAt: new Date().toISOString() })
      .where(eq(eggSources.id, source.id));

    return report;
  }

  /* --- Écriture ----------------------------------------------------------- */

  private async ensureNest(name: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: nests.id })
      .from(nests)
      .where(eq(nests.name, name));
    if (existing) return existing.id;

    const [created] = await this.db.insert(nests).values({ name }).returning({ id: nests.id });
    if (!created) throw new Error(`La famille « ${name} » n'a pas pu être créée.`);
    return created.id;
  }

  private async upsertEgg(
    parsed: ParsedEgg,
    origin: { nestId: string; sourceId: string | null; sourceRef: string | null },
  ): Promise<{ id: string; outcome: "created" | "updated" | "skipped" }> {
    const existing = await this.findExisting(parsed, origin);

    const values = {
      nestId: origin.nestId,
      name: parsed.name,
      description: parsed.description,
      author: parsed.author,
      dockerImages: parsed.dockerImages,
      startup: parsed.startup,
      configFiles: parsed.configFiles,
      configStartup: parsed.configStartup,
      configStop: parsed.configStop,
      configLogs: parsed.configLogs,
      installScript: parsed.installScript,
      installContainer: parsed.installContainer,
      installEntrypoint: parsed.installEntrypoint,
      features: parsed.features,
      fileDenylist: parsed.fileDenylist,
      consoleCommands: parsed.consoleCommands,
      playerCommands: parsed.playerCommands,
      gameQuery: parsed.gameQuery,
      sourceId: origin.sourceId,
      sourceRef: origin.sourceRef,
      importedAt: new Date().toISOString(),
    };

    if (!existing) {
      const [created] = await this.db
        .insert(eggs)
        // `enabled` garde son défaut — faux. Un egg fraîchement importé n'a été
        // relu par personne : le proposer aux clients dans la foulée reviendrait
        // à publier deux cents configurations d'un coup, sans les avoir vues.
        .values(values)
        .returning({ id: eggs.id });

      if (!created) throw new Error(`L'egg « ${parsed.name} » n'a pas pu être créé.`);
      await this.writeVariables(created.id, parsed);
      return { id: created.id, outcome: "created" };
    }

    if (existing.locallyModified) {
      return { id: existing.id, outcome: "skipped" };
    }

    await this.db.update(eggs).set(values).where(eq(eggs.id, existing.id));
    await this.writeVariables(existing.id, parsed);
    return { id: existing.id, outcome: "updated" };
  }

  /**
   * Retrouve l'egg que ce fichier met à jour, s'il existe.
   *
   * Par provenance d'abord — c'est l'identité stable d'un egg suivi. Par nom
   * ensuite, et seulement pour un import manuel : réimporter le même fichier
   * deux fois doit corriger l'egg, pas en créer un jumeau que personne ne
   * saura distinguer dans la liste.
   */
  private async findExisting(
    parsed: ParsedEgg,
    origin: { nestId: string; sourceId: string | null; sourceRef: string | null },
  ) {
    if (origin.sourceId && origin.sourceRef) {
      const [bySource] = await this.db
        .select({ id: eggs.id, locallyModified: eggs.locallyModified })
        .from(eggs)
        .where(and(eq(eggs.sourceId, origin.sourceId), eq(eggs.sourceRef, origin.sourceRef)));
      if (bySource) return bySource;

      /*
       * Un egg **orphelin** au même chemin est réadopté.
       *
       * Retirer une source met `source_id` à null sans supprimer les eggs — on
       * ne veut pas emporter des recettes qui font tourner des serveurs. Mais
       * `source_ref` reste, et c'est un chemin de dépôt : stable, et propre à
       * une recette précise.
       *
       * Sans cette reprise, réajouter un dépôt qu'on avait retiré recréerait
       * tout le catalogue à côté de l'ancien — deux cent cinquante doublons que
       * plus rien ne distingue dans la liste.
       */
      const [orphan] = await this.db
        .select({ id: eggs.id, locallyModified: eggs.locallyModified })
        .from(eggs)
        .where(and(isNull(eggs.sourceId), eq(eggs.sourceRef, origin.sourceRef)));
      return orphan ?? null;
    }

    const [byName] = await this.db
      .select({ id: eggs.id, locallyModified: eggs.locallyModified })
      .from(eggs)
      .where(and(eq(eggs.nestId, origin.nestId), eq(eggs.name, parsed.name)));
    return byName ?? null;
  }

  /**
   * Réécrit les variables de l'egg.
   *
   * Remplacement et non fusion : une variable retirée en amont doit disparaître
   * ici aussi. Laissée en place, elle continuerait d'être injectée dans le
   * conteneur, avec une valeur que plus rien ne définit.
   *
   * Les variables devenues inutiles sont supprimées avant d'insérer les
   * nouvelles, sans quoi la contrainte d'unicité sur `env_variable` refuserait
   * une variable simplement renommée.
   */
  private async writeVariables(eggId: string, parsed: ParsedEgg): Promise<void> {
    const keep = parsed.variables.map((variable) => variable.envVariable);

    await this.db
      .delete(eggVariables)
      .where(
        keep.length > 0
          ? and(eq(eggVariables.eggId, eggId), notInArray(eggVariables.envVariable, keep))
          : eq(eggVariables.eggId, eggId),
      );

    for (const variable of parsed.variables) {
      await this.db
        .insert(eggVariables)
        .values({ eggId, ...variable })
        .onConflictDoUpdate({
          target: [eggVariables.eggId, eggVariables.envVariable],
          set: {
            name: variable.name,
            description: variable.description,
            defaultValue: variable.defaultValue,
            userViewable: variable.userViewable,
            userEditable: variable.userEditable,
            rules: variable.rules,
          },
        });
    }
  }
}

/** Découpe `https://github.com/owner/name` en ses deux morceaux. */
function parseGitHubRepo(url: string): { owner: string; name: string } | null {
  const match = url
    .trim()
    .replace(/\.git$/, "")
    .match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i);
  const owner = match?.[1];
  const name = match?.[2];
  return owner && name ? { owner, name } : null;
}

/**
 * La branche par défaut du dépôt, telle que GitHub la déclare.
 *
 * `main` en repli, et non une erreur : si l'appel échoue — limite d'appels
 * atteinte, réseau coupé —, refuser l'ajout de la source empêcherait de
 * préparer la configuration hors ligne. La synchronisation, elle, dira
 * clairement que la branche est introuvable si le repli se révèle faux.
 */
async function defaultBranchOf(repo: { owner: string; name: string }): Promise<string> {
  try {
    const info = await fetchJson<{ default_branch?: unknown }>(
      `https://api.github.com/repos/${repo.owner}/${repo.name}`,
    );
    return typeof info.default_branch === "string" && info.default_branch.trim() !== ""
      ? info.default_branch
      : "main";
  } catch {
    return "main";
  }
}

/** Le premier segment du chemin, remis en forme lisible. */
function nestNameFromPath(path: string): string {
  const segment = path.split("/")[0] ?? "";
  if (!segment || segment.endsWith(".json")) return "Importés";
  return segment
    .replace(/[_-]+/g, " ")
    .replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase())
    .slice(0, 100);
}

/**
 * Lit une ressource distante en JSON.
 *
 * L'échéance est explicite : sans elle, un dépôt qui ne répond pas retiendrait
 * la requête d'administration jusqu'à ce que le navigateur abandonne, sans rien
 * afficher.
 */
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      // GitHub refuse les requêtes sans agent identifiable.
      "user-agent": "gamedashboard-gamedashboard",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 403 || response.status === 429) {
    throw new BadRequestException(
      "GitHub a refusé la requête : la limite d'appels anonymes est atteinte. Réessayez dans une heure.",
    );
  }
  if (response.status === 404) {
    throw new BadRequestException("Dépôt ou branche introuvable.");
  }
  if (!response.ok) {
    throw new BadRequestException(`GitHub a répondu ${response.status}.`);
  }

  return (await response.json()) as T;
}
