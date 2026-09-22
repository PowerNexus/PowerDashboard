import type {
  GameKey,
  MarketplaceProject,
  ProjectLoader,
  ProjectRelease,
} from "@gamedashboard/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformSettingsService } from "../admin/platform-settings.service";

/**
 * Catalogue CurseForge.
 *
 * Seule source du panel à exiger une clé, et cela se voit dans son
 * comportement : sans clé, elle ne rend pas une liste vide mais **échoue en le
 * disant**. Une source muette se confond avec une source sans résultats, et
 * l'exploitant chercherait longtemps pourquoi son catalogue est pauvre.
 *
 * Deux différences de fond avec Modrinth, qui expliquent le code :
 *
 * 1. **Les chargeurs et les versions de jeu sont mêlés** dans le même tableau
 *    `gameVersions` : on y trouve « 1.20.1 » à côté de « Forge ». Il faut les
 *    trier, et un fichier sans version numérique n'est pas exploitable.
 * 2. **Une URL de téléchargement peut être absente.** Un auteur peut interdire
 *    la distribution par un tiers, et l'API rend alors une URL vide. Ce n'est
 *    pas une panne : c'est une information à afficher, que le contrat porte
 *    déjà par `downloadUrl: null`.
 */

const API = "https://api.curseforge.com/v1";
const TIMEOUT_MS = 8000;

/** Au-delà, chaque résultat coûte un appel de plus pour ses fichiers. */
const SEARCH_LIMIT = 12;

/** Identifiants de jeux, tels que CurseForge les numérote. */
const GAME_ID: Partial<Record<GameKey, number>> = {
  minecraft: 432,
  rust: 4587,
  ark: 4483,
  "seven-days-to-die": 4548,
};

/**
 * Catégories de CurseForge pour Minecraft, et chargeurs de mods.
 *
 * Sans ce filtre, une recherche sur un serveur **Paper** rendait des mods
 * **Forge** : CurseForge trie par popularité toutes catégories confondues, et
 * les mods sont bien plus nombreux que les plugins. Le panel les annonçait
 * « installables », et les déposer dans `plugins/` n'aurait rien fait.
 *
 * Les deux familles ne se mélangent pas : un plugin Bukkit s'adresse au
 * serveur, un mod Forge à la machine virtuelle du jeu. Demander la bonne
 * catégorie dès la requête coûte un paramètre et supprime le problème à la
 * source — filtrer après coup laisserait une page presque vide, la recherche
 * ayant déjà dépensé ses trente résultats en mods.
 */
const MINECRAFT_CLASS = { plugins: 5, mods: 6 } as const;

/** Chargeurs de mods, tels que CurseForge les numérote. */
const MOD_LOADER = { forge: 1, fabric: 4 } as const;

/**
 * Ce qu'il faut demander à CurseForge pour un chargeur donné.
 *
 * `null` signifie « aucun filtre » : pour un proxy comme Velocity, CurseForge
 * n'a pas de catégorie propre, et restreindre au hasard vaudrait moins que de
 * laisser le contrôle de compatibilité trancher ensuite.
 */
function minecraftFilters(
  loader: ProjectLoader,
): { classId: number; modLoaderType?: number } | null {
  if (loader === "paper" || loader === "spigot") return { classId: MINECRAFT_CLASS.plugins };
  if (loader === "forge") return { classId: MINECRAFT_CLASS.mods, modLoaderType: MOD_LOADER.forge };
  if (loader === "fabric")
    return { classId: MINECRAFT_CLASS.mods, modLoaderType: MOD_LOADER.fabric };
  return null;
}

export class CurseForgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurseForgeUnavailableError";
  }
}

interface CurseForgeMod {
  id: number;
  name: string;
  summary: string;
  downloadCount: number;
  authors: { name: string }[];
  categories: { name: string }[];
  latestFiles: CurseForgeFile[];
}

interface CurseForgeFile {
  displayName: string;
  fileName: string;
  fileDate: string;
  gameVersions: string[];
  /** Vide lorsque l'auteur refuse la distribution par un tiers. */
  downloadUrl: string | null;
}

@Injectable()
export class CurseForgeClient {
  private readonly logger = new Logger(CurseForgeClient.name);

  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  /*
   * Il y avait ici un accesseur `configured`, « pour ne pas proposer la source
   * en vain ». Personne ne l'appelait. L'écran du catalogue fait déjà mieux :
   * il nomme les sources qui n'ont pas répondu **avec leur raison**, et la
   * raison rendue par `key()` dit désormais où poser la clé. Une source cachée
   * aurait été moins claire qu'une source qui explique son silence.
   */

  async search(
    query: string,
    game: GameKey,
    loader: ProjectLoader,
    gameVersion: string,
  ): Promise<MarketplaceProject[]> {
    const key = await this.key();
    const gameId = GAME_ID[game];
    if (!gameId) {
      throw new CurseForgeUnavailableError(`CurseForge ne référence pas « ${game} ».`);
    }

    const params = new URLSearchParams({
      gameId: String(gameId),
      searchFilter: query.trim(),
      pageSize: String(SEARCH_LIMIT),
      // 2 : tri par popularité décroissante.
      sortField: "2",
      sortOrder: "desc",
    });
    // Seul Minecraft est filtrable par version chez CurseForge.
    if (game === "minecraft" && gameVersion !== "") params.set("gameVersion", gameVersion);

    /*
     * Le chargeur du serveur restreint la recherche.
     *
     * Ce paramètre était **reçu et ignoré** : la signature promettait un
     * filtrage qui n'avait pas lieu, et un serveur Paper se voyait proposer
     * des mods Forge comme s'ils lui convenaient.
     */
    if (game === "minecraft") {
      const filtres = minecraftFilters(loader);
      if (filtres) {
        params.set("classId", String(filtres.classId));
        if (filtres.modLoaderType !== undefined) {
          params.set("modLoaderType", String(filtres.modLoaderType));
        }
      }
    }

    const { data } = await this.get<{ data: CurseForgeMod[] }>(`/mods/search?${params}`, key);

    const projects = await Promise.all(
      data.map(async (mod): Promise<MarketplaceProject | null> => {
        /*
         * Les fichiers sont redemandés, version de jeu à l'appui.
         *
         * `latestFiles` porte les dernières publications toutes versions
         * confondues : pour un mod ancien, aucune ne vise forcément la version
         * du serveur. Le repli sur `latestFiles` n'a lieu que si l'appel
         * échoue — mieux vaut des publications à filtrer côté panel que rien.
         */
        // Le chargeur demandé sert de repli : la recherche a été restreinte à
        // sa catégorie, donc un fichier muet lui appartient.
        const repli = game === "minecraft" && minecraftFilters(loader) ? loader : "any";
        const fetched = await this.filesOf(
          mod.id,
          game === "minecraft" ? gameVersion : "",
          key,
          repli,
        ).catch(() => [] as ProjectRelease[]);

        const releases = fetched.length > 0 ? fetched : toReleases(mod.latestFiles, repli);
        if (releases.length === 0) return null;

        return {
          // Préfixé par sa source : deux projets peuvent porter le même numéro
          // chez deux fournisseurs, et la trace d'installation les confondrait.
          id: `curseforge:${mod.id}`,
          source: "curseforge",
          name: mod.name,
          summary: mod.summary,
          author: mod.authors[0]?.name ?? "Inconnu",
          downloads: mod.downloadCount,
          categories: mod.categories.slice(0, 3).map((c) => c.name),
          releases: filterByLoader(releases, loader),
        };
      }),
    );

    return projects.filter((p): p is MarketplaceProject => p !== null && p.releases.length > 0);
  }

  /** Un projet précis, par l'identifiant préfixé du catalogue. */
  async project(projectId: string): Promise<MarketplaceProject | null> {
    const numeric = projectId.startsWith("curseforge:")
      ? projectId.slice("curseforge:".length)
      : "";
    if (!/^\d+$/.test(numeric)) return null;

    const key = await this.key();
    const mod = await this.get<{ data: CurseForgeMod }>(`/mods/${numeric}`, key)
      .then((r) => r.data)
      .catch(() => null);
    if (!mod) return null;

    // Sans filtre de version : la compatibilité est tranchée côté panel, sur
    // les publications complètes, ce qui est de toute façon plus sûr que de se
    // fier au filtrage du catalogue.
    const releases = await this.filesOf(mod.id, "", key).catch(() => toReleases(mod.latestFiles));
    if (releases.length === 0) return null;

    return {
      id: `curseforge:${mod.id}`,
      source: "curseforge",
      name: mod.name,
      summary: mod.summary,
      author: mod.authors[0]?.name ?? "Inconnu",
      downloads: mod.downloadCount,
      categories: mod.categories.slice(0, 3).map((c) => c.name),
      releases,
    };
  }

  private async filesOf(
    modId: number,
    gameVersion: string,
    key: string,
    chargeurParDefaut: ProjectLoader = "any",
  ): Promise<ProjectRelease[]> {
    const params = new URLSearchParams({ pageSize: "20" });
    if (gameVersion !== "") params.set("gameVersion", gameVersion);

    const { data } = await this.get<{ data: CurseForgeFile[] }>(
      `/mods/${modId}/files?${params}`,
      key,
    );
    return toReleases(data, chargeurParDefaut);
  }

  /**
   * La clé, vérifiée avant d'être employée.
   *
   * Les clés CurseForge sont au format bcrypt : « $2a$10$ » suivi de 53
   * caractères. Les outils qui étendent les variables d'environnement
   * remplacent « $2a » et « $10 » par du vide quand les dollars ne sont pas
   * échappés — et le symptôme serait alors un 403 sans la moindre explication.
   * Le dire ici épargne une heure de recherche à qui déploie.
   */
  private async key(): Promise<string> {
    const key = await this.resolvedKey();
    if (key === "") {
      throw new CurseForgeUnavailableError(
        "Aucune clé CurseForge : renseignez-la dans Réglages → Catalogue d'extensions.",
      );
    }
    if (!key.startsWith("$2")) {
      throw new CurseForgeUnavailableError(
        "La clé CurseForge paraît tronquée. Si elle vient du fichier d'environnement, " +
          "échappez chaque « $ » par « \\$ » — ou saisissez-la dans les réglages, où le problème ne se pose pas.",
      );
    }
    return key;
  }

  /**
   * La clé, des réglages d'abord, de l'environnement ensuite.
   *
   * Cet ordre est le bon : ce qu'un administrateur vient de saisir dans le
   * panel doit l'emporter sur une valeur posée autrefois dans un fichier, sans
   * quoi la saisie resterait sans effet et paraîtrait cassée.
   *
   * L'environnement demeure en repli pour ne pas éteindre CurseForge chez les
   * installations qui s'en servent déjà — la mienne comprise, au moment où
   * j'écris ceci.
   */
  private async resolvedKey(): Promise<string> {
    const stored = (await this.settings.secret("marketplace.curseforgeKey")).trim();
    if (stored !== "") return stored;
    return (process.env.CURSEFORGE_API_KEY ?? "").trim();
  }

  private async get<T>(path: string, key: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${API}${path}`, {
        headers: { "x-api-key": key, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CurseForgeUnavailableError(`CurseForge a répondu ${response.status}.`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CurseForgeUnavailableError) throw error;
      this.logger.warn(`Appel CurseForge en échec : ${describe(error)}`);
      throw new CurseForgeUnavailableError("CurseForge est injoignable.");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Traduit le vocabulaire d'un catalogue vers le nôtre.
 *
 * `null` quand le mot n'est pas un chargeur — le tableau d'où il vient mêle
 * chargeurs et versions de jeu, et il faut pouvoir écarter le reste.
 */
function toLoader(value: string): ProjectLoader | null {
  const normalized = value.toLowerCase();
  if (normalized === "paper" || normalized === "purpur") return "paper";
  if (normalized === "spigot" || normalized === "bukkit") return "spigot";
  if (normalized === "fabric") return "fabric";
  // NeoForge est un dérivé de Forge et consomme les mêmes publications.
  if (normalized === "forge" || normalized === "neoforge") return "forge";
  if (normalized === "velocity" || normalized === "bungeecord") return "velocity";
  return null;
}

/**
 * Convertit les fichiers de CurseForge en publications du panel.
 *
 * `chargeurParDefaut` dit quoi conclure quand un fichier **n'annonce aucun
 * chargeur**, ce qui est courant chez CurseForge. Le code y répondait
 * « compatible avec tout », et c'est ainsi qu'un mod Forge se retrouvait
 * proposé à un serveur Paper.
 *
 * « Je ne sais pas » n'est pas « tout ». Quand la recherche a été restreinte à
 * une catégorie — plugins Bukkit, ou mods d'un chargeur précis — un fichier
 * muet appartient forcément à cette famille, et c'est elle qu'on retient.
 * Ailleurs, faute de mieux, `any` demeure : le contrôle de compatibilité
 * tranchera avec les versions de jeu.
 */
function toReleases(
  files: CurseForgeFile[],
  chargeurParDefaut: ProjectLoader = "any",
): ProjectRelease[] {
  return files
    .map((file): ProjectRelease | null => {
      const loaders = file.gameVersions.map(toLoader).filter((l): l is ProjectLoader => l !== null);
      // Une entrée commençant par un chiffre est une version de jeu ; le reste
      // est un chargeur ou une étiquette, et n'a rien à faire ici.
      const gameVersions = file.gameVersions.filter((v) => /^\d/.test(v));
      if (gameVersions.length === 0) return null;

      return {
        version: file.displayName,
        gameVersions,
        loaders: loaders.length > 0 ? [...new Set(loaders)] : [chargeurParDefaut],
        publishedAt: file.fileDate,
        // Transmise telle quelle : une URL absente est une information à
        // afficher, pas un défaut à masquer par une valeur inventée.
        downloadUrl: file.downloadUrl ?? null,
        fileName: file.fileName,
      };
    })
    .filter((r): r is ProjectRelease => r !== null);
}

/**
 * Écarte les publications qui ne visent pas le chargeur du serveur.
 *
 * CurseForge ne sait pas filtrer là-dessus à la recherche, et laisser passer
 * un mod Forge sur un serveur Paper afficherait un bouton « Installer » qui
 * produirait un serveur qui ne démarre plus.
 */
function filterByLoader(releases: ProjectRelease[], loader: ProjectLoader): ProjectRelease[] {
  if (loader === "any") return releases;
  return releases.filter(
    (release) =>
      release.loaders.includes("any") ||
      release.loaders.includes(loader) ||
      (loader === "paper" && release.loaders.includes("spigot")),
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
