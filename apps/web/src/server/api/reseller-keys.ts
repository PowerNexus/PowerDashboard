"use server";

import { APPLICATION_SCOPE_CATALOGUE, isPlatformScope } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import type { ApplicationKey } from "./application-keys";
import { apiFetch, apiSendFor } from "./client";

/**
 * Les clés applicatives d'un revendeur.
 *
 * Les mêmes gestes que côté administration, sur d'autres routes : celles de
 * l'espace revendeur, qui bornent tout au périmètre de la session. Le revendeur
 * ne désigne jamais de qui il parle — c'est sa session qui le dit, et c'est ce
 * qui l'empêche de demander une clé pour le parc d'un confrère.
 */

export async function fetchResellerKeys(): Promise<ApplicationKey[]> {
  const { data } = await apiFetch<{ data: ApplicationKey[] }>("/api/v1/reseller/keys");
  return data;
}

/**
 * Émet une clé et rend le secret **une seule fois**.
 *
 * Il traverse cette fonction et s'arrête à l'écran : ni journalisé, ni mis en
 * cache, ni relisible ensuite — la base n'en garde qu'un condensat.
 */
export async function createResellerKey(input: {
  name: string;
  scopes: string[];
  allowedIps: string[];
  expiresInDays: number;
}): Promise<{ plaintext: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { plaintext: string } }>(
      "/api/v1/reseller/keys",
      input,
    );
    revalidatePath("/reseller/keys");
    return { plaintext: data.plaintext, error: null };
  } catch (error) {
    return {
      plaintext: null,
      error: error instanceof Error ? error.message : "Création refusée.",
    };
  }
}

export async function revokeResellerKey(keyId: string): Promise<{ error: string | null }> {
  try {
    await apiSendFor(`/api/v1/reseller/keys/${keyId}`, undefined, "DELETE");
    revalidatePath("/reseller/keys");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Révocation refusée." };
  }
}

/**
 * Les portées qu'un revendeur peut s'accorder.
 *
 * Celles de la plateforme sont retirées de l'écran **et** refusées par l'API.
 * Les afficher ferait cocher des cases qui feraient échouer l'émission, ce qui
 * est la pire façon d'apprendre une règle — après l'avoir enfreinte, sans
 * savoir laquelle.
 */
export async function resellerScopeCatalogue(): Promise<typeof APPLICATION_SCOPE_CATALOGUE> {
  return APPLICATION_SCOPE_CATALOGUE.map((groupe) => ({
    ...groupe,
    // Même règle qu'à l'émission, et le **même code** : deux listes à tenir
    // d'accord finiraient par proposer une portée que l'API refuse ensuite.
    scopes: groupe.scopes.filter(({ scope }) => !isPlatformScope(scope)),
  })).filter((groupe) => groupe.scopes.length > 0);
}
