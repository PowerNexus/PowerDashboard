/**
 * Interrogation d'un serveur FiveM ou RedM (plateforme Cfx.re).
 *
 * FXServer sert, sur le port même du jeu, deux documents JSON que la liste des
 * serveurs de Cfx.re emploie : `/info.json` (version, réglages publics dont
 * `sv_maxClients`) et `/players.json` (les joueurs connectés). Aucune
 * configuration n'est exigée côté serveur.
 *
 * Ce module ne fait que lire ; la requête HTTP vit dans
 * `game-query.transport.ts`.
 */

import { cleanPlayerNames, cleanStatusText, type GameStatus } from "./game-status";

/** Ce que dit `/info.json`. */
export interface CfxInfo {
  name: string | null;
  version: string | null;
  playersMax: number | null;
}

/**
 * Codes de couleur de Cfx.re (`^1Serveur ^7RP`) : décoration, pas contenu.
 * Retirés avant le nettoyage commun, qui ne les connaît pas.
 */
function stripColours(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/\^\d/g, "") : value;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Lit `/info.json`, ou `null` si ce n'est pas celui d'un FXServer.
 *
 * Un autre service HTTP sur le port du jeu peut très bien répondre du JSON :
 * sans `vars` ni `server`, ce n'est pas un serveur Cfx.re, et le déclarer
 * joignable serait mentir.
 */
export function parseCfxInfo(raw: string): CfxInfo | null {
  const parsed = parseJson(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const body = parsed as { server?: unknown; vars?: unknown };
  const vars =
    typeof body.vars === "object" && body.vars !== null && !Array.isArray(body.vars)
      ? (body.vars as Record<string, unknown>)
      : null;
  if (vars === null && typeof body.server !== "string") return null;

  // `sv_maxClients` est une chaîne dans `vars` (« 48 ») : seul un entier
  // positif est cru.
  const max = vars ? String(vars.sv_maxClients ?? "").trim() : "";
  return {
    name: cleanStatusText(stripColours(vars?.sv_projectName ?? vars?.sv_hostname)),
    version: cleanStatusText(body.server),
    playersMax: /^\d{1,5}$/.test(max) ? Number(max) : null,
  };
}

/**
 * Lit `/players.json` : la liste complète des joueurs connectés.
 *
 * Le document porte aussi leurs identifiants (licence, Steam, Discord,
 * adresse IP) : **seul le nom** est retenu. Le reste n'a rien à faire dans
 * la base du panel.
 */
export function parseCfxPlayers(raw: string): { online: number; names: string[] } | null {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return null;
  const names = parsed.map((entry) =>
    typeof entry === "object" && entry !== null
      ? stripColours((entry as { name?: unknown }).name)
      : null,
  );
  return { online: parsed.length, names: cleanPlayerNames(names) };
}

/** Forme commune à tous les jeux, rangée dans `server_health.query_payload`. */
export function cfxStatus(
  info: CfxInfo,
  players: { online: number; names: string[] } | null,
): GameStatus {
  return {
    // Sans la liste, le compteur reste inconnu : FiveM ne le met pas dans
    // `/info.json`, et zéro serait faux.
    playersOnline: players?.online ?? null,
    playersMax: info.playersMax,
    version: info.version,
    sample: players?.names ?? null,
    name: info.name,
  };
}
