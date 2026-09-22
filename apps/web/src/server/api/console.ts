"use server";

import { apiSend } from "./client";

/**
 * Commandes et alimentation, **par le panel** et non par le websocket.
 *
 * Le websocket de Wings accepte `send command` et `set state` directement : la
 * console les envoyait ainsi, et personne n'en gardait trace. Un « ban » ou un
 * « op » tapé dans la console n'apparaissait nulle part au journal d'activité,
 * là où le même geste fait depuis l'API y figurait — deux portes, une seule
 * surveillée.
 *
 * Tout passe donc par l'API, qui est l'endroit opposable : elle vérifie la
 * permission, refuse pendant une installation, et consigne. La sortie, elle,
 * continue d'arriver par le websocket — c'est du volume, et le panel n'a rien
 * à y faire.
 *
 * Le coût est un aller-retour de plus par commande. Sur le rythme d'une frappe
 * humaine, il ne se voit pas ; sur celui d'un flux de console, il aurait été
 * rédhibitoire, et c'est bien pourquoi seuls les ordres empruntent ce chemin.
 */

export async function sendConsoleCommand(
  serverId: string,
  command: string,
): Promise<{ error: string | null }> {
  return attempt(() => apiSend(`/api/v1/client/servers/${serverId}/command`, { command }));
}

export async function sendPowerSignal(
  serverId: string,
  signal: string,
): Promise<{ error: string | null }> {
  return attempt(() => apiSend(`/api/v1/client/servers/${serverId}/power`, { signal }));
}

/**
 * Le refus est **rendu**, pas avalé.
 *
 * C'est par là qu'arrive « le contrat de licence n'est pas accepté » ou « une
 * installation est en cours » : les taire laisserait quelqu'un cliquer sur
 * « démarrer » sans que rien ne se passe ni ne s'explique.
 */
async function attempt(call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Action refusée." };
  }
}
