import { VERSION_PATTERN } from "./update-state";

/**
 * La dernière release publiée du dépôt, par l'API de GitHub.
 *
 * Sans jeton : le dépôt est public, et un jeton serait un secret de plus à
 * garder sur l'hébergement. La limite anonyme (soixante requêtes par heure
 * et par adresse, partagée avec les voisins d'un mutualisé) est tenue par
 * l'étiquette HTTP : une réponse 304 ne compte pas, et la vérification ne
 * passe qu'à intervalle long.
 *
 * `releases/latest` ne rend jamais une préversion : une étiquette
 * `v1.2.0-rc.1` se publie sans atteindre les hébergements.
 */
export interface PublishedRelease {
  version: string;
  archiveUrl: string;
  checksumUrl: string;
  publishedAt: string | null;
}

export type LatestRelease =
  | { kind: "unchanged" }
  | { kind: "none"; etag: string | null }
  | { kind: "found"; release: PublishedRelease; etag: string | null };

export const GITHUB_API = "https://api.github.com";

/** Nom de l'archive autonome d'une version (infra/release/autonome.mjs). */
export function archiveName(version: string): string {
  return `gamedashboard-${version}-autonome.tar.gz`;
}

export async function fetchLatestRelease(
  repository: string,
  options: { etag?: string | null; apiBase?: string; userAgent: string },
): Promise<LatestRelease> {
  const response = await fetch(
    `${options.apiBase ?? GITHUB_API}/repos/${repository}/releases/latest`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": options.userAgent,
        ...(options.etag ? { "if-none-match": options.etag } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (response.status === 304) return { kind: "unchanged" };
  const etag = response.headers.get("etag");
  // Aucune release encore : GitHub répond 404.
  if (response.status === 404) return { kind: "none", etag };
  if (!response.ok) {
    throw new Error(`GitHub a répondu ${response.status} pour la dernière release.`);
  }

  const body = (await response.json()) as {
    tag_name?: unknown;
    published_at?: unknown;
    assets?: { name?: unknown; browser_download_url?: unknown }[];
  };
  const version = typeof body.tag_name === "string" ? body.tag_name : "";
  if (!VERSION_PATTERN.test(version)) return { kind: "none", etag };

  const url = (name: string) =>
    body.assets?.find((asset) => asset.name === name)?.browser_download_url;
  const archiveUrl = url(archiveName(version));
  const checksumUrl = url(`${archiveName(version)}.sha256`);
  // Une release publiée avant l'archive autonome ne s'installe pas ici.
  if (typeof archiveUrl !== "string" || typeof checksumUrl !== "string") {
    return { kind: "none", etag };
  }

  return {
    kind: "found",
    etag,
    release: {
      version,
      archiveUrl,
      checksumUrl,
      publishedAt: typeof body.published_at === "string" ? body.published_at : null,
    },
  };
}
