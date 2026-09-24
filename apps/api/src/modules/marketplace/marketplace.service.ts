import {
  type AddonState,
  addonState,
  GAME_SOURCES,
  gameVersionFromPing,
  type InstalledAddon,
  type MarketplaceProject,
  type MarketplaceSource,
  RUNTIME_STATE_FRESH_WINDOW,
} from "@gamedashboard/contracts";
import {
  type Database,
  eggs,
  eggVariables,
  marketplaceInstalls,
  nests,
  serverHealth,
  servers,
  serverVariables,
} from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { WingsClientService } from "../wings/wings-client.service";
import { CurseForgeClient } from "./curseforge.client";
import { isTrustedDownload } from "./modpack-source";
import { ModrinthClient } from "./modrinth.client";
import { type DetectedRuntime, detectRuntime } from "./server-runtime";
import { SpigetClient } from "./spiget.client";

export interface CatalogueEntry {
  project: MarketplaceProject;
  state: AddonState;
}

/** Une source interrogée et son sort, pour pouvoir le dire à l'écran. */
export interface SourceOutcome {
  source: MarketplaceSource;
  /** Message d'échec, ou `null` quand la source a répondu. */
  error: string | null;
  /** Projets qu'elle a rendus. Zéro avec `error` nul est un vrai « rien trouvé ». */
  count: number;
}

export interface CatalogueResult {
  /** `null` quand aucun catalogue ne correspond au serveur. Voir `detectRuntime`. */
  runtime: DetectedRuntime | null;
  /** Raison lisible quand `runtime` est nul : l'écran doit pouvoir l'expliquer. */
  unavailableReason: string | null;
  entries: CatalogueEntry[];
  /**
   * Le sort de chaque source.
   *
   * Sans cela, une source tombée et une source sans résultats donnent le même
   * écran : une liste plus courte, sans rien qui l'explique. L'exploitant
   * conclurait que le plugin cherché n'existe pas, alors que le catalogue qui
   * le porte n'a simplement pas répondu.
   */
  sources: SourceOutcome[];
}

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
    @Inject(ModrinthClient) private readonly modrinth: ModrinthClient,
    @Inject(CurseForgeClient) private readonly curseforge: CurseForgeClient,
    @Inject(SpigetClient) private readonly spiget: SpigetClient,
  ) {}

  /**
   * Catalogue applicable à un serveur.
   *
   * Le runtime est déduit du serveur, jamais reçu de l'appelant : le laisser
   * choisir son chargeur lui permettrait de faire installer un mod Forge sur
   * un Paper, qui ne démarrerait plus.
   */
  async catalogue(serverId: string, query: string): Promise<CatalogueResult> {
    const runtime = await this.runtimeOf(serverId);
    if (!runtime) {
      return {
        runtime: null,
        unavailableReason:
          "Aucun catalogue public ne correspond à ce serveur. Le chargeur d'extensions n'a pas pu être déterminé depuis son egg.",
        entries: [],
        sources: [],
      };
    }

    const [found, installed] = await Promise.all([
      this.searchAll(query, runtime),
      this.installedFor(serverId),
    ]);

    /*
     * Un même projet peut exister dans deux catalogues.
     *
     * Les identifiants étant préfixés par leur source, les deux entrées
     * coexistent sans se confondre — et c'est voulu : les publications n'y
     * sont pas les mêmes, et l'une peut être installable là où l'autre est
     * bloquée par son auteur. Le tri par téléchargements les rapproche, ce qui
     * suffit à ce qu'on les voie côte à côte.
     */
    const projects = found.projects.sort((a, b) => b.downloads - a.downloads);

    return {
      runtime,
      unavailableReason: null,
      entries: projects.map((project) => ({
        project,
        state: addonState(project, runtime, installed.get(project.id)),
      })),
      sources: found.sources,
    };
  }

  /**
   * Installe ou met à jour une extension.
   *
   * L'adresse de téléchargement n'est **jamais** reçue du client : elle est
   * relue depuis le catalogue à ce moment précis. Accepter une URL du
   * navigateur ferait du daemon un téléchargeur de fichiers arbitraires, pilotable
   * par quiconque a accès à un serveur.
   */
  async install(
    serverId: string,
    projectId: string,
  ): Promise<{ version: string; fileName: string }> {
    const runtime = await this.runtimeOf(serverId);
    if (!runtime) throw new BadRequestException("Ce serveur n'a pas de catalogue d'extensions.");

    const found = await this.projectById(projectId);
    if (!found) throw new NotFoundException("Extension introuvable dans le catalogue.");

    const installed = await this.installedFor(serverId);
    const state = addonState(found, runtime, installed.get(projectId));

    const release =
      state.kind === "installable" || state.kind === "update-available" ? state.release : null;

    if (!release) {
      throw new ConflictException(
        state.kind === "download-blocked"
          ? "L'auteur de cette extension interdit son téléchargement par un tiers. Installez-la manuellement."
          : state.kind === "up-to-date"
            ? "Cette extension est déjà à jour."
            : "Cette extension n'est pas compatible avec ce serveur.",
      );
    }
    if (!release.downloadUrl) {
      throw new ConflictException("Cette publication n'a pas de fichier téléchargeable.");
    }

    /*
     * L'adresse rendue par Modrinth ou CurseForge passe par la liste des
     * dépôts connus avant d'aller au daemon, qui télécharge sans regarder
     * depuis le réseau du node. SpigotMC n'est pas concerné : son adresse est
     * composée ici (`spiget.client.ts`), pas lue dans une réponse.
     */
    const source = sourceOfProjectId(projectId);
    if (
      (source === "modrinth" || source === "curseforge") &&
      !isTrustedDownload(release.downloadUrl)
    ) {
      this.logger.warn(`Adresse de ${projectId} refusée : ${release.downloadUrl}`);
      throw new ConflictException(
        "Le catalogue indique une adresse de téléchargement hors de ses dépôts habituels. Installation refusée ; réessayez plus tard, ou installez l'extension manuellement.",
      );
    }

    const previous = installed.get(projectId);

    await this.wings.pullFile(serverId, runtime.directory, release.downloadUrl, release.fileName);

    /**
     * L'ancien fichier est retiré **après** l'écriture du nouveau.
     *
     * Dans l'autre sens, une mise à jour qui échoue laisserait le serveur sans
     * extension du tout. Ici, le pire cas laisse deux versions côte à côte —
     * gênant, visible, et réparable.
     */
    if (previous && previous.fileName !== release.fileName) {
      await this.wings
        .deleteFiles(serverId, runtime.directory, [previous.fileName])
        .catch(() => undefined);
    }

    await this.db
      .insert(marketplaceInstalls)
      .values({
        serverId,
        // Déduite de l'identifiant, et non écrite en dur : les projets viennent
        // aussi de CurseForge, et les enregistrer tous comme « modrinth »
        // rendait la colonne fausse pour la moitié des lignes.
        source: sourceOfProjectId(projectId),
        projectId,
        versionId: release.version,
        installedFiles: [release.fileName],
        installedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [
          marketplaceInstalls.serverId,
          marketplaceInstalls.source,
          marketplaceInstalls.projectId,
        ],
        set: {
          versionId: release.version,
          installedFiles: [release.fileName],
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

    return { version: release.version, fileName: release.fileName };
  }

  /**
   * Désinstalle.
   *
   * Les fichiers réellement posés sont relus depuis la trace d'installation,
   * jamais devinés depuis le nom du projet : c'est précisément la raison d'être
   * de la colonne `installed_files`.
   */
  async uninstall(serverId: string, projectId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(marketplaceInstalls)
      .where(
        and(
          eq(marketplaceInstalls.serverId, serverId),
          eq(marketplaceInstalls.projectId, projectId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException("Cette extension n'est pas installée.");

    const runtime = await this.runtimeOf(serverId);
    if (runtime && row.installedFiles.length > 0) {
      await this.wings.deleteFiles(serverId, runtime.directory, row.installedFiles);
    }

    await this.db.delete(marketplaceInstalls).where(eq(marketplaceInstalls.id, row.id));
  }

  /** Extensions installées, indexées par projet. */
  private async installedFor(serverId: string): Promise<Map<string, InstalledAddon>> {
    const rows = await this.db
      .select()
      .from(marketplaceInstalls)
      .where(eq(marketplaceInstalls.serverId, serverId));

    return new Map(
      rows.map((row) => [
        row.projectId,
        {
          projectId: row.projectId,
          version: row.versionId,
          installedAt: row.installedAt,
          fileName: row.installedFiles[0] ?? "",
        },
      ]),
    );
  }

  /**
   * Interroge toutes les sources applicables au jeu du serveur.
   *
   * **Une source en échec n'en fait pas tomber d'autres.** Une clé CurseForge
   * expirée ne doit pas vider un catalogue Modrinth qui répond parfaitement :
   * on rend ce qu'on a, et on dit ce qui manque. C'est aussi ce qui permet
   * d'ajouter une source sans fragiliser celles qui marchent.
   */
  private async searchAll(
    query: string,
    runtime: DetectedRuntime,
  ): Promise<{ projects: MarketplaceProject[]; sources: SourceOutcome[] }> {
    const wanted = GAME_SOURCES[runtime.game];

    const settled = await Promise.all(
      wanted.map(
        async (source): Promise<{ outcome: SourceOutcome; projects: MarketplaceProject[] }> => {
          try {
            const projects = await this.searchOne(source, query, runtime);
            return { outcome: { source, error: null, count: projects.length }, projects };
          } catch (error) {
            this.logger.warn(`Source ${source} en échec : ${describe(error)}`);
            return {
              outcome: { source, error: describe(error), count: 0 },
              projects: [],
            };
          }
        },
      ),
    );

    return {
      projects: settled.flatMap((s) => s.projects),
      sources: settled.map((s) => s.outcome),
    };
  }

  private searchOne(
    source: MarketplaceSource,
    query: string,
    runtime: DetectedRuntime,
  ): Promise<MarketplaceProject[]> {
    if (source === "modrinth") {
      return this.modrinth.search(query, runtime.loader, runtime.gameVersion);
    }
    if (source === "curseforge") {
      return this.curseforge.search(query, runtime.game, runtime.loader, runtime.gameVersion);
    }
    if (source === "spigot") {
      // SpigotMC ne porte que des plugins Bukkit : les proposer à un serveur
      // Fabric ou Forge ferait installer un fichier que le jeu ignore.
      if (runtime.loader !== "paper" && runtime.loader !== "spigot") return Promise.resolve([]);
      return this.spiget.search(query);
    }
    // `custom` désigne un dépôt interne, qui n'existe pas encore. Rendre une
    // liste vide plutôt que lever : ce n'est pas une panne, c'est une absence.
    return Promise.resolve([]);
  }

  /**
   * Retrouve un projet par son identifiant.
   *
   * Par un appel direct, et non par la recherche : aucun catalogue ne retrouve
   * un identifiant opaque en plein texte. La source se lit dans le préfixe de
   * l'identifiant — c'est précisément à cela qu'il sert.
   *
   * La compatibilité est ensuite évaluée côté panel, sur les publications
   * complètes, ce qui est de toute façon plus sûr que de se fier au filtrage
   * du catalogue.
   */
  private projectById(projectId: string): Promise<MarketplaceProject | null> {
    const source = sourceOfProjectId(projectId);
    if (source === "modrinth") return this.modrinth.project(projectId);
    if (source === "curseforge") return this.curseforge.project(projectId);
    if (source === "spigot") return this.spiget.project(projectId);
    return Promise.resolve(null);
  }

  /**
   * Runtime du serveur, déduit de son egg et de ses variables.
   *
   * Les variables non visibles par le client sont incluses ici : la version du
   * jeu peut être dans l'une d'elles, et cette lecture ne sort pas de l'API.
   */
  private async runtimeOf(serverId: string): Promise<DetectedRuntime | null> {
    const [row] = await this.db
      .select({ eggName: eggs.name, nestName: nests.name })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) return null;

    const variables = await this.db
      .select({ name: eggVariables.envVariable, value: serverVariables.value })
      .from(serverVariables)
      .innerJoin(eggVariables, eq(serverVariables.eggVariableId, eggVariables.id))
      .where(eq(serverVariables.serverId, serverId));

    const defaults = await this.db
      .select({ name: eggVariables.envVariable, value: eggVariables.defaultValue })
      .from(eggVariables)
      .innerJoin(eggs, eq(eggVariables.eggId, eggs.id))
      .innerJoin(servers, eq(servers.eggId, eggs.id))
      .where(eq(servers.id, serverId));

    // Les valeurs du serveur recouvrent celles de l'egg, dans cet ordre.
    const merged = Object.fromEntries([
      ...defaults.map((v) => [v.name, v.value]),
      ...variables.map((v) => [v.name, v.value]),
    ]) as Record<string, string>;

    const runtime = detectRuntime(row.eggName, row.nestName, merged);
    if (runtime?.gameVersion !== "") return runtime;

    /*
     * La version vient du serveur lui-même, faute de mieux.
     *
     * `detectRuntime` la tire des variables de l'egg, et refuse de trancher
     * quand elles disent « latest » — ce qui est le cas courant. Le catalogue
     * ne filtrait alors plus que sur le chargeur, et proposait un plugin de
     * 1.8 à un serveur en 1.21 : un refus honnête de deviner qui se payait en
     * résultats faux.
     *
     * Or le serveur annonce sa version à chaque sonde, et le panel la range
     * déjà en base sans jamais la relire. On préfère donc ce qu'il **dit** à
     * ce qu'on ne sait pas — c'est une observation, pas une supposition.
     *
     * Toujours pas de version si la sonde n'a rien obtenu : un serveur éteint
     * ne répond pas, et l'on retombe alors sur le comportement d'avant plutôt
     * que sur un numéro périmé.
     */
    const versionObservee = await this.observedVersion(serverId);
    return versionObservee === "" ? runtime : { ...runtime, gameVersion: versionObservee };
  }

  /**
   * Version annoncée au dernier relevé **abouti** de la sonde de jeu.
   *
   * Les sondes manquées sont écartées : leur charge utile est nulle, et une
   * jointure naïve prendrait la dernière ligne plutôt que la dernière
   * réponse. La fenêtre est la même que celle des autres relevés frais — un
   * serveur arrêté depuis une heure ne doit pas continuer à dicter le
   * filtrage du catalogue.
   */
  private async observedVersion(serverId: string): Promise<string> {
    const [row] = await this.db
      .select({ announced: sql<string | null>`${serverHealth.queryPayload} ->> 'version'` })
      .from(serverHealth)
      .where(
        and(
          eq(serverHealth.serverId, serverId),
          eq(serverHealth.reachable, true),
          sql`${serverHealth.at} > now() - ${RUNTIME_STATE_FRESH_WINDOW}::interval`,
        ),
      )
      .orderBy(desc(serverHealth.at))
      .limit(1);

    return gameVersionFromPing(row?.announced ?? null);
  }

  /** Nombre d'extensions installées, pour l'afficher sans charger le catalogue. */
  async installedCount(serverId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(marketplaceInstalls)
      .where(eq(marketplaceInstalls.serverId, serverId));
    return row?.n ?? 0;
  }
}

/**
 * La source d'un projet, lue dans son identifiant.
 *
 * Le catalogue préfixe chaque identifiant par sa provenance — `modrinth:AAbb`,
 * `curseforge:12345` — précisément pour que deux projets portant le même
 * numéro chez deux fournisseurs ne se confondent pas. La colonne `source` s'en
 * déduit donc ; l'écrire à la main garantissait qu'elle finirait par mentir.
 *
 * `custom` en repli : un identifiant sans préfixe connu n'est pas une erreur à
 * lever au moment d'enregistrer une installation qui, elle, a réussi.
 */
function sourceOfProjectId(projectId: string): "modrinth" | "curseforge" | "spigot" | "custom" {
  const prefix = projectId.split(":")[0];
  if (prefix === "modrinth" || prefix === "curseforge" || prefix === "spigot") return prefix;
  return "custom";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
