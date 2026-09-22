import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";
import { getBranding } from "@/server/api/branding";

/**
 * Manifeste d'installation, **à la marque du domaine d'arrivée**.
 *
 * Un manifeste figé aurait installé « GameDashboard » sur l'écran d'accueil du
 * client d'un revendeur, qui n'a jamais entendu ce nom. Comme le favicon et le
 * titre de l'onglet, il suit donc l'hôte de la requête — c'est aussi pourquoi
 * il n'est pas un fichier statique.
 *
 * `start_url` pointe la racine et non `/servers` : l'application installée
 * doit s'ouvrir sur ce que l'utilisateur a le droit de voir, et la racine
 * redirige déjà selon la session. Y mettre une page gardée ferait s'ouvrir
 * l'application sur un écran de connexion même lorsque la session est valide.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [branding, t] = await Promise.all([getBranding(), getTranslations("app")]);

  return {
    name: branding.name,
    short_name: branding.name,
    description: t("description"),
    start_url: "/",
    // `standalone` et non `fullscreen` : le panel a des formulaires et des
    // liens externes, et masquer la barre d'état retirerait l'heure et le
    // réseau à quelqu'un qui surveille un serveur.
    display: "standalone",
    orientation: "any",
    background_color: "#0f1117",
    theme_color: branding.accent,
    // Les deux tailles que réclament les navigateurs pour proposer
    // l'installation, plus le masque Android qui recadre lui-même.
    icons: [
      { src: "/brand/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    /*
     * Les raccourcis longs-appui.
     *
     * Trois au plus : Android n'en montre pas davantage, et les suivants
     * seraient écrits pour rien.
     */
    shortcuts: [
      { name: t("shortcutServers"), url: "/servers" },
      { name: t("shortcutAccount"), url: "/account" },
      { name: t("shortcutStatus"), url: "/status" },
    ],
  };
}
