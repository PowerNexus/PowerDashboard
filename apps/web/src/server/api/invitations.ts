"use server";

import { apiFetch, apiSendFor } from "./client";

/** Ce qu'un lien d'invitation montre avant toute connexion. */
export interface InvitePreview {
  serverName: string;
  email: string;
  permissions: string[];
  expiresAt: string;
  invitedBy: string;
  accountExists: boolean;
}

/**
 * Lit l'invitation, ou dit pourquoi elle ne vaut plus.
 *
 * Le message d'erreur de l'API est rendu tel quel : « expirée », « déjà
 * employée » et « inconnue » appellent des gestes différents — redemander une
 * invitation, se connecter, ou vérifier le lien — et les fondre dans un
 * « invitation invalide » obligerait à écrire au support pour savoir lequel.
 */
export async function fetchInvite(
  token: string,
): Promise<{ invite: InvitePreview | null; error: string | null }> {
  try {
    const { data } = await apiFetch<{ data: InvitePreview }>(
      `/api/v1/invitations/${encodeURIComponent(token)}`,
    );
    return { invite: data, error: null };
  } catch (error) {
    return {
      invite: null,
      error: error instanceof Error ? error.message : "Lien d'invitation illisible.",
    };
  }
}

/**
 * Crée le compte de l'invité et accepte dans la foulée.
 *
 * **L'adresse n'est pas envoyée** : l'API la prend dans l'invitation. C'est ce
 * qui permet à ce chemin de fonctionner alors même que les inscriptions sont
 * fermées — on n'ouvre pas une porte, on honore une invitation nominative.
 */
export async function registerFromInvite(
  token: string,
  input: { nameFirst: string; nameLast: string; password: string },
): Promise<{ serverId: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { serverId: string } }>(
      `/api/v1/invitations/${encodeURIComponent(token)}/register`,
      input,
    );
    return { serverId: data.serverId, error: null };
  } catch (error) {
    return {
      serverId: null,
      error: error instanceof Error ? error.message : "Création refusée.",
    };
  }
}

export async function acceptInvite(
  token: string,
): Promise<{ serverId: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { serverId: string } }>(
      `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
      {},
    );
    return { serverId: data.serverId, error: null };
  } catch (error) {
    return {
      serverId: null,
      error: error instanceof Error ? error.message : "Acceptation refusée.",
    };
  }
}
