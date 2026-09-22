import { LOCALES, type Locale } from "./locale";
import en from "./messages/en.json" with { type: "json" };
import fr from "./messages/fr.json" with { type: "json" };

export * from "./locale";

/**
 * Catalogues chargés statiquement.
 *
 * Deux langues et quelques kilo-octets : un chargement dynamique ajouterait une
 * frontière asynchrone à chaque rendu pour économiser une quantité négligeable.
 * À revoir le jour où le nombre de langues le justifiera.
 */
export const MESSAGES = { fr, en } as const;

/**
 * Le français est la langue de référence : c'est le catalogue dans lequel les
 * clés sont créées, et celui dont la forme fait foi. Les autres s'y conforment,
 * ce que `messages.test.ts` vérifie.
 */
export type Messages = typeof fr;

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** Libellé d'une langue dans sa propre langue, pour le sélecteur. */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

export const SUPPORTED_LOCALES = LOCALES;
