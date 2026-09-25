"use client";

import { MAX_CONSOLE_COMMAND_LENGTH } from "@gamedashboard/contracts";
import { COMMAND_HISTORY_SIZE } from "@gamedashboard/ui";
import { useCallback, useEffect, useState } from "react";

/**
 * Historique des commandes de console, par serveur, **dans le navigateur**.
 *
 * Pas en base, et c'est voulu : les arguments d'une commande sont l'endroit
 * où passent les mots de passe (`/login …`, `rcon_password …`). Le panel a
 * cessé de les écrire dans son journal (ASVS NC-13) ; les garder côté serveur
 * pour l'autocomplétion reviendrait sur cette décision. Dans le navigateur,
 * l'historique ne quitte pas l'appareil de celui qui l'a tapé, et la
 * déconnexion l'efface (`clearCommandHistories`).
 */
const PREFIX = "gd.console.history.";

/**
 * Relit un historique stocké, sans jamais lui faire confiance : la valeur a pu
 * être écrite par une autre version du panel, ou à la main dans les outils du
 * navigateur. Tout ce qui n'est pas une liste de commandes plausibles est
 * écarté plutôt que de faire tomber la console.
 */
export function parseCommandHistory(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === "string" &&
        entry.trim() !== "" &&
        entry.length <= MAX_CONSOLE_COMMAND_LENGTH,
    )
    .slice(0, COMMAND_HISTORY_SIZE);
}

/** L'historique d'un serveur, lu après hydratation et réécrit à chaque commande. */
export function useCommandHistory(serverId: string) {
  const key = `${PREFIX}${serverId}`;
  const [history, setHistory] = useState<string[]>([]);

  // `localStorage` n'existe pas côté serveur : le lire pendant le rendu ferait
  // diverger les deux rendus.
  useEffect(() => {
    try {
      setHistory(parseCommandHistory(window.localStorage.getItem(key)));
    } catch {
      setHistory([]);
    }
  }, [key]);

  const update = useCallback(
    (next: string[]) => {
      setHistory(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Stockage plein ou refusé (navigation privée) : l'historique vit
        // alors le temps de la page, ce qui reste utile.
      }
    },
    [key],
  );

  return [history, update] as const;
}

/** Efface l'historique de tous les serveurs : appelé à la déconnexion. */
export function clearCommandHistories(storage: Pick<Storage, "length" | "key" | "removeItem">) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
