import type {
  MarketplaceProject,
  ProjectLoader,
  ProjectRelease,
  ReleaseDependency,
} from "@gamedashboard/contracts";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

/**
 * Catalogue Modrinth.
 *
 * Choisi comme première source parce qu'il ne demande **aucune clé** : le
 * catalogue est public, et une intégration sans secret est une intégration qui
 * ne peut pas fuiter. CurseForge, qui en exige une, vit dans un client séparé
 * et reste inactif tant que la clé n'est pas configurée.
 *
 * Modrinth demande un `User-Agent` identifiant : c'est écrit dans leur
 * documentation, et un agent générique se fait limiter en débit.
 */
const API = "https://api.modrinth.com/v2";
const USER_AGENT = "GameDashboard/GameDashboard (panel de jeu, contact@gamedashboard.fr)";

/** Au-delà, la page devient plus longue à lire qu'à faire défiler. */
const SEARCH_LIMIT = 30;

/** Les appels sortants du panel ont un délai court : une page ne doit pas pendre. */
const TIMEOUT_MS = 8000;

interface ModrinthHit {
  project_id: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  categories: string[];
}

interface ModrinthVersion {
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  files: { url: string; filename: string; primary: boolean }[];
  dependencies?: {
    project_id: string | null;
    version_id: string | null;
    dependency_type: "required" | "optional" | "incompatible" | "embedded";
  }[];
}

@Injectable()
export class ModrinthClient {
  private readonly logger = new Logger(ModrinthClient.name);

  /**
   * Recherche, puis complète chaque résultat par ses publications.
   *
   * Deux appels par projet seraient trente requêtes pour une page. On passe
   * donc par `/versions` projet par projet, mais **en parallèle et borné** :
   * sans la borne, une recherche ouvrirait trente connexions sortantes d'un
   * coup et se ferait limiter en débit par Modrinth.
   */
  async search(
    query: string,
    loader: ProjectLoader,
    gameVersion: string,
  ): Promise<MarketplaceProject[]> {
    const facets: string[][] = [["project_type:mod", "project_type:plugin"]];
    if (loader !== "any") facets.push([`categories:${loader}`]);
    if (gameVersion !== "") facets.push([`versions:${gameVersion}`]);

    const params = new URLSearchParams({
      limit: String(SEARCH_LIMIT),
      index: "downloads",
      facets: JSON.stringify(facets),
    });
    if (query.trim() !== "") params.set("query", query.trim());

    const found = await this.get<{ hits: ModrinthHit[] }>(`/search?${params}`);

    const projects = await Promise.all(
      found.hits.map(async (hit): Promise<MarketplaceProject | null> => {
        const releases = await this.releasesFor(hit.project_id);
        // Un projet sans publication exploitable est écarté : l'afficher
        // donnerait un bouton « Installer » qui ne peut rien installer.
        if (releases.length === 0) return null;

        return {
          // Préfixé par sa source : sans cela, la trace d'installation ne sait
          // plus d'où vient le projet, et deux catalogues peuvent numéroter pareil.
          id: `modrinth:${hit.project_id}`,
          source: "modrinth" as const,
          name: hit.title,
          summary: hit.description,
          author: hit.author,
          downloads: hit.downloads,
          categories: hit.categories,
          releases,
        };
      }),
    );

    return projects.filter((p): p is MarketplaceProject => p !== null);
  }

  /**
   * Un projet précis, par son identifiant.
   *
   * Indispensable, et pas une commodité : la recherche plein texte de Modrinth
   * ne reconnaît **pas** un identifiant opaque comme `hXiIvTyT`. Chercher le
   * projet à installer en passant son id à `search` ne rend donc jamais rien,
   * et toute installation échouerait en « extension introuvable » — alors que
   * le projet figure à l'écran, dans la liste d'où l'on vient de cliquer.
   */
  async project(projectId: string): Promise<MarketplaceProject | null> {
    /*
     * L'identifiant arrive préfixé par sa source, tel que le catalogue l'a
     * rendu. Modrinth ne connaît que la partie qui le suit — la lui passer
     * entière rendrait un 404 sur un projet parfaitement existant.
     */
    if (!projectId.startsWith("modrinth:")) return null;
    const slug = projectId.slice("modrinth:".length);

    let hit: {
      id: string;
      title: string;
      description: string;
      categories: string[];
      downloads: number;
    };
    try {
      hit = await this.get(`/project/${encodeURIComponent(slug)}`);
    } catch (error) {
      this.logger.warn(`Projet ${projectId} illisible : ${message(error)}`);
      return null;
    }

    const releases = await this.releasesFor(hit.id);
    if (releases.length === 0) return null;

    return {
      id: `modrinth:${hit.id}`,
      source: "modrinth",
      name: hit.title,
      summary: hit.description,
      // L'auteur ne figure pas sur cette réponse, contrairement à celle de la
      // recherche. Il n'entre dans aucune décision : on ne fait pas un appel
      // de plus pour l'obtenir.
      author: "",
      downloads: hit.downloads,
      categories: hit.categories,
      releases,
    };
  }

  /**
   * Publications d'un projet.
   *
   * L'échec d'un projet ne fait pas échouer la recherche entière : un projet
   * retiré entre la recherche et la lecture de ses versions est un cas courant,
   * et il ne doit pas vider la page.
   */
  private async releasesFor(projectId: string): Promise<ProjectRelease[]> {
    let versions: ModrinthVersion[];
    try {
      versions = await this.get<ModrinthVersion[]>(`/project/${projectId}/version`);
    } catch (error) {
      this.logger.warn(`Versions de ${projectId} illisibles : ${message(error)}`);
      return [];
    }

    return versions
      .map((version): ProjectRelease | null => {
        // Le fichier « primary » est celui que l'auteur désigne comme
        // l'artefact à installer ; les autres sont des sources ou des
        // variantes. À défaut, le premier fait l'affaire.
        const file = version.files.find((f) => f.primary) ?? version.files[0];
        if (!file) return null;

        return {
          version: version.version_number,
          gameVersions: version.game_versions,
          loaders: version.loaders.filter(isKnownLoader),
          publishedAt: new Date(version.date_published).toISOString(),
          downloadUrl: file.url,
          fileName: file.filename,
          dependencies: toDependencies(version.dependencies ?? []),
        };
      })
      .filter(
        (r): r is ProjectRelease => r !== null && r.gameVersions.length > 0 && r.loaders.length > 0,
      );
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${API}${path}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(`Modrinth a répondu ${response.status}.`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      // Le catalogue est un service tiers : son indisponibilité n'est pas une
      // panne du panel, et le distinguer permet de le dire à l'écran.
      throw new ServiceUnavailableException(`Modrinth est injoignable : ${message(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Dépendances d'une version Modrinth.
 *
 * `embedded` est déjà dans le fichier, `optional` reste un choix : seules
 * `required` et `incompatible` sont retenues. Une dépendance désignée par sa
 * seule version, sans projet, est écartée : la résoudre coûterait un appel de
 * plus pour un cas que les auteurs n'emploient presque jamais.
 */
export function toDependencies(
  raw: NonNullable<ModrinthVersion["dependencies"]>,
): ReleaseDependency[] {
  return raw.flatMap((dep) =>
    dep.project_id && (dep.dependency_type === "required" || dep.dependency_type === "incompatible")
      ? [{ projectId: `modrinth:${dep.project_id}`, kind: dep.dependency_type }]
      : [],
  );
}

const KNOWN_LOADERS = new Set<string>([
  "paper",
  "spigot",
  "fabric",
  "forge",
  "velocity",
  "oxide",
  "carbon",
]);

/**
 * Modrinth publie des chargeurs que notre modèle ne connaît pas — `quilt`,
 * `neoforge`, `bukkit`… Les écarter plutôt que les convertir : traiter
 * `neoforge` comme `forge` proposerait des mods qui ne démarreraient pas.
 */
function isKnownLoader(value: string): value is ProjectLoader {
  return KNOWN_LOADERS.has(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "erreur inconnue";
}
