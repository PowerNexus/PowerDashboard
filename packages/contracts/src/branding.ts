/**
 * Marque affichée par le panel.
 *
 * Le panel sert plusieurs marques depuis une seule installation : celle de la
 * plateforme, et celle de chaque revendeur qui a branché son propre domaine.
 *
 * **Le domaine décide, et lui seul.** Une requête arrivée sur
 * `panel.revendeur.fr` porte la marque de ce revendeur ; sur le domaine de la
 * plateforme, celle de la plateforme. Ce choix est délibéré : un client peut
 * louer chez deux revendeurs à la fois, et déduire la marque de « son »
 * revendeur n'aurait alors pas de réponse. Le domaine, lui, est sans ambiguïté,
 * se résout avant toute session, et se met en cache.
 *
 * La conséquence est à connaître : un client qui se connecte au domaine de la
 * plateforme y voit la marque de la plateforme, même s'il est client d'un
 * revendeur. C'est le domaine qu'on lui communique qui fait la marque blanche.
 */

/** Ce qu'un revendeur peut changer. Tout est facultatif. */
export interface BrandingOverrides {
  name: string;
  logoUrl: string;
  faviconUrl: string;
  /** Couleur d'accent, en notation hexadécimale. */
  accent: string;
  supportUrl: string;
  termsUrl: string;
  footerText: string;
  loginTagline: string;
}

/** Marque effective, une fois les replis appliqués. Jamais de champ vide obligatoire. */
export interface Branding {
  name: string;
  logoUrl: string;
  faviconUrl: string;
  accent: string;
  supportUrl: string | null;
  termsUrl: string | null;
  footerText: string | null;
  loginTagline: string | null;
  /** Revendeur dont la marque est servie, ou `null` pour la plateforme. */
  resellerId: string | null;
}

/** Logo et couleur de la plateforme, quand rien n'est réglé. */
export const DEFAULT_BRANDING: Branding = {
  name: "GameDashboard",
  logoUrl: "/brand/gamedashboard-logo.webp",
  faviconUrl: "/brand/gamedashboard-logo.webp",
  accent: "#7c3aed",
  supportUrl: null,
  termsUrl: null,
  footerText: null,
  loginTagline: null,
  resellerId: null,
};

/**
 * Compose la marque effective, **champ par champ**.
 *
 * Un revendeur qui ne veut changer que la couleur ne doit pas avoir à
 * redéclarer un logo, un nom et des mentions légales : chaque valeur vide
 * retombe sur celle de la plateforme, puis sur celle du produit.
 *
 * Aucune valeur n'est inventée : un champ facultatif que personne n'a rempli
 * reste `null`, et l'écran cesse simplement de proposer le lien correspondant.
 */
export function composeBranding(
  platform: Partial<BrandingOverrides>,
  reseller: (Partial<BrandingOverrides> & { resellerId: string }) | null,
): Branding {
  const pick = (key: keyof BrandingOverrides): string =>
    (reseller?.[key] ?? "").trim() || (platform[key] ?? "").trim();

  const optional = (key: keyof BrandingOverrides): string | null => pick(key) || null;

  return {
    name: pick("name") || DEFAULT_BRANDING.name,
    logoUrl: pick("logoUrl") || DEFAULT_BRANDING.logoUrl,
    // Le favicon retombe sur le logo avant de retomber sur celui du produit :
    // un revendeur qui pose son logo sans favicon veut évidemment le sien dans
    // l'onglet, pas celui de la plateforme.
    faviconUrl: pick("faviconUrl") || pick("logoUrl") || DEFAULT_BRANDING.faviconUrl,
    accent: normalizeHex(pick("accent")) ?? DEFAULT_BRANDING.accent,
    supportUrl: optional("supportUrl"),
    termsUrl: optional("termsUrl"),
    footerText: optional("footerText"),
    loginTagline: optional("loginTagline"),
    resellerId: reseller?.resellerId ?? null,
  };
}

/**
 * Couleur hexadécimale acceptable, ou `null`.
 *
 * Contrôlée plutôt que recopiée : cette valeur part dans une variable CSS, et
 * une chaîne arbitraire y ferait entrer ce qu'on veut — une déclaration, une
 * accolade fermante, et le reste de la feuille de style appartient à qui a
 * rempli le champ.
 */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed) ? trimmed : null;
}

/**
 * Adresse acceptable pour une image ou un lien de marque.
 *
 * `https://` ou chemin interne, rien d'autre. Un `javascript:` recopié dans un
 * attribut `src` ou `href` s'exécute dans la page ; un `http://` sur une page
 * servie en TLS est bloqué par le navigateur, et le logo disparaît sans
 * message. Les deux se refusent à la saisie plutôt qu'à l'affichage.
 *
 * `//hote/…` et `/\hote/…` sont refusés alors qu'ils commencent par `/` : le
 * navigateur les lit comme des adresses **d'un autre hôte**, et le « chemin
 * interne » servirait une image — ou un lien d'assistance — pris ailleurs.
 *
 * Partagée par la marque des revendeurs et celle de la plateforme : deux
 * copies de cette règle finiraient par en laisser passer une que l'autre
 * refuse.
 */
export function isSafeBrandUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("/")) return !/^\/[/\\]/.test(trimmed);
  if (!trimmed.toLowerCase().startsWith("https://")) return false;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Nom d'hôte acceptable pour un domaine propre.
 *
 * Refusé plutôt que nettoyé : un domaine se recopie depuis un registre, et
 * « corriger » silencieusement une saisie ferait vérifier un nom que le
 * revendeur n'a pas demandé — puis échouer sans qu'il comprenne pourquoi.
 */
export function isValidDomain(value: string): boolean {
  const host = value.trim().toLowerCase();
  if (host.length === 0 || host.length > 253) return false;
  // Au moins un point : un nom sans étiquette de tête ne se délègue pas, et un
  // « localhost » n'a rien à faire ici.
  if (!host.includes(".")) return false;
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(host);
}

/** Nom où le revendeur publie sa preuve de possession. */
export function ownershipRecordName(domain: string): string {
  return `_gamedashboard.${domain.trim().toLowerCase()}`;
}
