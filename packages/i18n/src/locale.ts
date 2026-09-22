/**
 * Choix de la langue (§1.2 du plan).
 *
 * Aucun préfixe de langue dans l'URL, contrairement à l'usage courant sur les
 * sites publics. Un panel est entièrement authentifié : la langue appartient au
 * compte, pas à l'adresse. Deux raisons concrètes :
 *
 * - un lien vers un serveur partagé entre collègues doit s'ouvrir dans la
 *   langue de celui qui clique, pas dans celle de qui a copié l'URL ;
 * - il n'y a rien à référencer, donc aucun bénéfice à faire exister deux
 *   adresses pour la même page.
 *
 * L'ordre de préférence descend du plus explicite au plus deviné.
 */

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Le français est la langue de référence : c'est celle dans laquelle on écrit. */
export const DEFAULT_LOCALE: Locale = "fr";

/** Nom du cookie, aligné sur la convention Next.js. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Meilleure correspondance dans un en-tête `Accept-Language`.
 *
 * Les qualités (`;q=`) sont respectées, et `fr-CA` retombe sur `fr` : refuser
 * une variante régionale afficherait l'anglais à un Québécois, ce qui est le
 * contraire de ce qu'il a demandé.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const quality = q ? Number.parseFloat(q.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    // Une qualité nulle est un refus explicite de cette langue, pas une absence
    // de préférence : la retenir irait contre la demande du navigateur.
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    if (isLocale(tag)) return tag;
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

export interface LocaleSources {
  /** Langue enregistrée sur le compte. */
  user?: string | null;
  /** Cookie posé par le sélecteur de langue. */
  cookie?: string | null;
  /** En-tête du navigateur. */
  acceptLanguage?: string | null;
}

/**
 * Résout la langue effective.
 *
 * Le compte l'emporte sur le cookie, qui l'emporte sur le navigateur : un choix
 * enregistré dans les préférences doit suivre l'utilisateur d'une machine à
 * l'autre, sinon le réglage ne sert à rien.
 */
export function resolveLocale(sources: LocaleSources): Locale {
  if (isLocale(sources.user)) return sources.user;
  if (isLocale(sources.cookie)) return sources.cookie;
  return matchAcceptLanguage(sources.acceptLanguage) ?? DEFAULT_LOCALE;
}
