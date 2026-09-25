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
  /**
   * Adresse de réponse des courriels (`Reply-To`). Le courrier part toujours
   * de l'adresse de la plateforme — celle que SPF et DKIM couvrent — mais une
   * réponse du client arrive chez le revendeur. Voir `mailSender`.
   */
  replyTo: string;
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
  replyTo: string | null;
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
  replyTo: null,
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
    // Contrôlée ici aussi, et pas seulement à la saisie : une ancienne valeur
    // invalide ne doit jamais atteindre un en-tête de courriel.
    replyTo: isValidReplyTo(pick("replyTo")) ? pick("replyTo") || null : null,
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

/** Longueur maximale d'une adresse électronique (RFC 5321). */
export const REPLY_TO_MAX_LENGTH = 254;

/**
 * Adresse de réponse acceptable, ou vide.
 *
 * Volontairement stricte : cette valeur finit dans un en-tête de courriel, où
 * un saut de ligne ajouterait des en-têtes — un `Bcc:` glissé par qui remplit
 * le champ. Ni blanc, ni chevron, ni guillemet, ni virgule : une seule adresse.
 */
export function isValidReplyTo(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (trimmed.length > REPLY_TO_MAX_LENGTH) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: on les refuse dans un en-tête.
  return /^[^\s\u0000-\u001f\u007f@<>"(),;:\\[\]]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
    trimmed,
  );
}

/** Longueur maximale du nom d'expéditeur affiché. */
export const SENDER_NAME_MAX_LENGTH = 80;

/**
 * Ce qu'un courriel porte de la marque : le nom d'expéditeur affiché et
 * l'adresse de réponse.
 *
 * **L'adresse d'envoi, elle, ne change pas.** Écrire « From: support@revendeur.fr »
 * depuis le serveur de la plateforme ferait échouer SPF et DKIM chez le
 * destinataire : le courrier finirait en indésirables, ou refusé. Le nom
 * affiché et la réponse suffisent à ce que le client voie son hébergeur.
 */
export interface MailSender {
  fromName: string;
  replyTo: string | null;
}

export function mailSender(branding: Pick<Branding, "name" | "replyTo">): MailSender {
  const fromName = branding.name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: on les retire d'un en-tête.
    .replace(/[\u0000-\u001f\u007f"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SENDER_NAME_MAX_LENGTH)
    .trim();
  return {
    fromName: fromName || DEFAULT_BRANDING.name,
    replyTo: branding.replyTo && isValidReplyTo(branding.replyTo) ? branding.replyTo : null,
  };
}

/* --- Images de marque envoyées par fichier ------------------------------- */

/** Les deux images qu'une marque peut envoyer. */
export const BRAND_IMAGE_KINDS = ["logo", "favicon"] as const;
export type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number];

export function isBrandImageKind(value: unknown): value is BrandImageKind {
  return typeof value === "string" && (BRAND_IMAGE_KINDS as readonly string[]).includes(value);
}

/**
 * Taille maximale d'une image de marque : 512 Kio.
 *
 * Un logo d'en-tête ou une icône d'onglet n'en demande pas davantage, et
 * l'image est rangée en base puis relue à chaque premier affichage : un
 * plafond bas protège la base et la mémoire du seul processus de l'API
 * (hébergement cPanel). Il tient aussi sous la limite d'un mégaoctet que Next
 * impose au corps d'une action serveur, par où l'envoi transite.
 */
export const BRAND_IMAGE_MAX_BYTES = 512 * 1024;

/** Types servis, et rien d'autre. */
export type BrandImageType = "image/png" | "image/jpeg" | "image/webp" | "image/x-icon";

/**
 * Type réel d'une image, lu dans ses premiers octets — jamais dans le nom du
 * fichier ni dans le type annoncé par le navigateur, que l'expéditeur choisit.
 *
 * **Pas de SVG**, et c'est voulu : un SVG est un document qui peut porter du
 * script. Ouvert directement à son adresse, il s'exécuterait sous le domaine
 * du panel — ou d'un revendeur — avec ses cookies. Les quatre formats admis
 * sont des images matricielles, que le navigateur ne fait qu'afficher.
 */
export function sniffBrandImage(bytes: Uint8Array): BrandImageType | null {
  const debut = (...octets: number[]) => octets.every((octet, i) => bytes[i] === octet);
  const ascii = (texte: string, depart: number) =>
    [...texte].every((c, i) => bytes[depart + i] === c.charCodeAt(0));

  if (debut(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (debut(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (bytes.length >= 12 && ascii("RIFF", 0) && ascii("WEBP", 8)) return "image/webp";
  // ICO : réservé nul, type 1 (icône), au moins une image dans le répertoire.
  if (bytes.length >= 6 && debut(0x00, 0x00, 0x01, 0x00) && (bytes[4] ?? 0) + (bytes[5] ?? 0) > 0) {
    return "image/x-icon";
  }
  return null;
}

/**
 * Chemin **interne** où l'interface sert une image envoyée.
 *
 * Interne, donc relatif au domaine d'arrivée : le même chemin sert sur le
 * domaine de la plateforme et sur celui de chaque revendeur, et passe la règle
 * `isSafeBrandUrl` comme n'importe quelle adresse saisie. Chaque envoi reçoit
 * un nouvel identifiant : le contenu d'une adresse ne change jamais, ce qui
 * permet de le garder en cache sans limite.
 */
export const BRAND_IMAGE_PATH_PREFIX = "/brand/fichier/";

export function brandImagePath(id: string): string {
  return `${BRAND_IMAGE_PATH_PREFIX}${id}`;
}

/** Identifiant d'image acceptable : un UUID, rien qui puisse sortir du chemin. */
export function isBrandImageId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

/** Identifiant de l'image qu'une adresse de marque désigne, ou `null`. */
export function brandImageIdOf(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith(BRAND_IMAGE_PATH_PREFIX)) return null;
  const id = trimmed.slice(BRAND_IMAGE_PATH_PREFIX.length);
  return isBrandImageId(id) ? id : null;
}
