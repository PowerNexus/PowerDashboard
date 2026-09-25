"use server";

import { BRAND_IMAGE_MAX_BYTES, isBrandImageKind } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiSendFor } from "./client";

/** À qui l'image est envoyée : la marque du revendeur connecté, ou celle de la plateforme. */
export type BrandImageTarget = "reseller" | "platform";

const ROUTES: Record<BrandImageTarget, string> = {
  reseller: "/api/v1/reseller/branding/images",
  platform: "/api/v1/admin/settings/brand-images",
};

/**
 * Envoie un logo ou un favicon, et rend l'adresse interne qui le sert.
 *
 * Le fichier traverse l'action serveur puis part à l'API en octets bruts :
 * c'est elle qui lit le type réel et refuse le SVG, les droits sont ceux de la
 * session (revendeur, ou administrateur pour la plateforme).
 */
export async function uploadBrandImage(
  target: BrandImageTarget,
  kind: string,
  form: FormData,
): Promise<{ url: string | null; error: string | null }> {
  const fichier = form.get("file");
  if (!(target in ROUTES) || !isBrandImageKind(kind) || !(fichier instanceof File)) {
    return { url: null, error: "Aucune image reçue." };
  }
  // Contrôlé ici aussi : inutile de faire traverser un fichier trop lourd.
  if (fichier.size > BRAND_IMAGE_MAX_BYTES) {
    return {
      url: null,
      error: `Image trop lourde : ${Math.ceil(BRAND_IMAGE_MAX_BYTES / 1024)} Kio au plus.`,
    };
  }

  try {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const { data } = await apiSendFor<{ data: { url: string } }>(
      `${ROUTES[target]}/${kind}`,
      octets,
    );
    // Le logo figure dans l'en-tête de toutes les pages.
    revalidatePath("/", "layout");
    return { url: data.url, error: null };
  } catch (error) {
    return { url: null, error: error instanceof Error ? error.message : "Envoi refusé." };
  }
}
