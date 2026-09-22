"use server";

import type { BrandingOverrides } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiFetch, apiSendFor } from "./client";

/**
 * État du domaine propre d'un revendeur.
 *
 * `ownershipRecord` et `cnameTarget` sont servis par l'API plutôt que
 * reconstruits ici : l'écran doit afficher **exactement** ce que le serveur
 * vérifiera, et deux constructions du même nom finiraient par diverger — le
 * revendeur publierait alors un enregistrement que la vérification ne regarde
 * pas.
 */
export interface DomainState {
  domain: string | null;
  token: string | null;
  verifiedAt: string | null;
  checkedAt: string | null;
  failure: string | null;
  ownershipRecord: { name: string; value: string } | null;
  cnameTarget: string;
}

export interface ResellerBranding {
  overrides: BrandingOverrides;
  domain: DomainState;
}

export async function fetchResellerBranding(): Promise<ResellerBranding> {
  const { data } = await apiFetch<{ data: ResellerBranding }>("/api/v1/reseller/branding");
  return data;
}

export async function saveResellerBranding(
  overrides: BrandingOverrides,
): Promise<{ error: string | null }> {
  return await send("/api/v1/reseller/branding", overrides);
}

export async function setResellerDomain(domain: string): Promise<{ error: string | null }> {
  return await send("/api/v1/reseller/branding/domain", { domain });
}

export async function verifyResellerDomain(): Promise<{ error: string | null }> {
  return await send("/api/v1/reseller/branding/domain/verify", {});
}

/**
 * Le refus de l'API est rendu tel quel, jamais remplacé.
 *
 * « CNAME vers autre chose » et « TXT introuvable » se corrigent à deux
 * endroits différents de la zone : les fondre en un « échec de vérification »
 * ferait chercher la panne du mauvais côté.
 */
async function send(path: string, body: unknown): Promise<{ error: string | null }> {
  try {
    await apiSendFor(path, body);
    // La marque apparaît dans l'en-tête et le titre de l'onglet de toutes les
    // pages : c'est le chemin entier qui est périmé, pas cet écran seul.
    revalidatePath("/", "layout");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
