import type { MarketplaceProject, ProjectRelease } from "@gamedashboard/contracts";
import { Injectable, Logger } from "@nestjs/common";

/**
 * Catalogue SpigotMC, par Spiget.
 *
 * SpigotMC n'expose aucune API ; Spiget est le miroir que tout l'écosystème
 * emploie, et il ne demande pas de clé. C'est la source historique des plugins
 * Bukkit, et beaucoup n'existent nulle part ailleurs.
 *
 * **Le piège est le téléchargement.** Spiget sert deux natures de ressources :
 *
 * - celles hébergées par SpigotMC, dont le fichier est un vrai `.jar` ;
 * - celles hébergées **ailleurs**, où l'API redirige vers un site tiers qui
 *   rend le plus souvent une page HTML.
 *
 * Laisser passer les secondes ferait déposer par le daemon un fichier nommé
 * `.jar` qui contient du HTML : le serveur refuserait de démarrer, et rien à
 * l'écran n'expliquerait pourquoi. Elles sortent donc avec `downloadUrl: null`,
 * que le contrat affiche déjà comme « l'auteur interdit le téléchargement par
 * un tiers » — c'est-à-dire : à installer à la main.
 *
 * Les ressources payantes sont écartées pour la même raison : leur
 * téléchargement exige une session d'achat que le panel n'a pas.
 */

const API = "https://api.spiget.org/v2";
const TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 12;

/** Spiget demande un agent identifiable, et le refus est silencieux sans lui. */
const USER_AGENT = "GameDashboard/GameDashboard (panel de jeu, contact@gamedashboard.fr)";

interface SpigetResource {
  id: number;
  name: string;
  tag: string;
  downloads: number;
  testedVersions?: string[];
  premium?: boolean;
  /** `type` vaut « external » quand le fichier est hébergé hors de SpigotMC. */
  file?: { type?: string; url?: string };
  author?: { id: number };
  releaseDate?: number;
  updateDate?: number;
}

@Injectable()
export class SpigetClient {
  private readonly logger = new Logger(SpigetClient.name);

  /**
   * Recherche de plugins.
   *
   * Aucun filtre de version n'est envoyé : Spiget ne connaît que des
   * « versions testées », déclarées par l'auteur et souvent incomplètes. Le
   * tri par compatibilité a lieu côté panel, sur ce que la ressource annonce.
   */
  async search(query: string): Promise<MarketplaceProject[]> {
    const trimmed = query.trim();
    const params = new URLSearchParams({
      size: String(SEARCH_LIMIT),
      sort: "-downloads",
      fields: "id,name,tag,downloads,testedVersions,premium,file,releaseDate,updateDate",
    });

    /*
     * Sans terme de recherche, la recherche de Spiget rend une erreur : c'est
     * la liste des ressources qu'il faut demander à la place. Les deux rendent
     * la même forme, et l'écran affiche donc les plus téléchargées à l'ouverture
     * plutôt qu'une page vide.
     */
    const path =
      trimmed === ""
        ? `/resources?${params}`
        : `/search/resources/${encodeURIComponent(trimmed)}?${params}&field=name`;

    const resources = await this.get<SpigetResource[]>(path);
    return resources
      .map((resource) => this.toProject(resource))
      .filter((p): p is MarketplaceProject => p !== null);
  }

  /** Une ressource précise, par l'identifiant préfixé du catalogue. */
  async project(projectId: string): Promise<MarketplaceProject | null> {
    const numeric = projectId.startsWith("spigot:") ? projectId.slice("spigot:".length) : "";
    if (!/^\d+$/.test(numeric)) return null;

    const resource = await this.get<SpigetResource>(`/resources/${numeric}`).catch(() => null);
    return resource ? this.toProject(resource) : null;
  }

  private toProject(resource: SpigetResource): MarketplaceProject | null {
    // Une ressource payante ne se télécharge pas sans session d'achat : la
    // proposer donnerait un bouton qui échoue toujours.
    if (resource.premium === true) return null;

    const external = (resource.file?.type ?? "").toLowerCase() === "external";
    const hosted = !external && (resource.file?.url ?? "") !== "";

    /*
     * Les « versions testées » sont déclaratives et souvent absentes.
     *
     * Quand elles manquent, la publication ne s'annonce pour aucune version en
     * particulier — ce que le contrat exige d'exprimer par au moins une entrée.
     * On ne peut pas en inventer une : `isReleaseCompatible` comparerait une
     * version fausse et écarterait le plugin, ou pire, l'accepterait à tort.
     * La ressource est donc écartée, et c'est honnête.
     */
    const gameVersions = (resource.testedVersions ?? []).filter((v) => /^\d/.test(v));
    if (gameVersions.length === 0) return null;

    const updated = resource.updateDate ?? resource.releaseDate;
    if (!updated) return null;

    const release: ProjectRelease = {
      // Spiget ne nomme pas les versions d'une ressource dans sa fiche : la
      // date de mise à jour tient lieu de repère, et c'est elle qui décide
      // aussi de « une mise à jour est disponible ».
      version: new Date(updated * 1000).toISOString().slice(0, 10),
      gameVersions,
      // Un plugin SpigotMC vise Bukkit et tourne donc sur Paper, que le
      // contrat sait déjà déduire.
      loaders: ["spigot"],
      publishedAt: new Date(updated * 1000).toISOString(),
      // Hébergé ailleurs : le téléchargement rendrait une page HTML nommée
      // « .jar ». Nul plutôt que trompeur.
      downloadUrl: hosted ? `${API}/resources/${resource.id}/download` : null,
      fileName: `${slug(resource.name)}.jar`,
    };

    return {
      id: `spigot:${resource.id}`,
      source: "spigot",
      name: resource.name,
      summary: resource.tag,
      // Spiget ne rend que l'identifiant de l'auteur dans une recherche ; le
      // résoudre coûterait un appel par ligne pour une information d'affichage.
      author: "SpigotMC",
      downloads: resource.downloads,
      categories: [],
      releases: [release],
    };
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${API}${path}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Spiget a répondu ${response.status}.`);
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(`Appel Spiget en échec : ${describe(error)}`);
      throw new Error("SpigotMC est injoignable.");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Nom de fichier tiré du nom de la ressource.
 *
 * Spiget ne dit pas comment le fichier s'appellera : le téléchargement passe
 * par une redirection. Il faut donc le nommer nous-mêmes, et le nommer de
 * façon **stable** — c'est ce nom qui servira à retirer le plugin plus tard.
 */
function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "plugin"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
