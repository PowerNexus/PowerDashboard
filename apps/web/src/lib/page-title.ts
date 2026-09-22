import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Titre d'onglet traduit.
 *
 * Next évalue `metadata` à la construction, avant toute requête : un titre
 * écrit en dur y resterait français quelle que soit la langue du lecteur.
 * `generateMetadata` s'exécute par requête, seul moment où la locale est
 * connue.
 *
 * `key` vaut « metaTitle » quand l'onglet doit être plus court que le titre de
 * la page — « Statut » plutôt que « Statut de la plateforme ».
 */
export function pageTitle(namespace: string, key = "title") {
  return async (): Promise<Metadata> => {
    const t = await getTranslations(namespace);
    return { title: t(key) };
  };
}
