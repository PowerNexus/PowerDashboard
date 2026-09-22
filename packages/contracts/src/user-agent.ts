/**
 * Lecture de l'en-tête `User-Agent`.
 *
 * Le but n'est pas d'identifier un appareil — un en-tête se falsifie, et rien
 * ici ne doit servir à une décision de sécurité. Le but est qu'on reconnaisse
 * sa propre session dans la liste : « Firefox sur Windows » se retrouve d'un
 * coup d'œil, « Mozilla/5.0 (Windows NT 10.0; Win64; x64) … » non.
 *
 * Aucune bibliothèque : les tables de correspondance des grands parseurs
 * pèsent plusieurs centaines de kilo-octets, se périment à chaque version de
 * navigateur, et servent ici à écrire deux mots sous un nom d'appareil.
 */

/**
 * Ce que l'interface a besoin de savoir pour choisir une icône.
 *
 * `tool` n'est pas un appareil : c'est un programme — `curl`, un script, une
 * bibliothèque HTTP. Le distinguer évite d'annoncer « curl/8.18.0 » comme s'il
 * s'agissait d'un ordinateur.
 *
 * `unknown` couvre le cas le plus trompeur : l'agent **n'est pas parvenu**
 * jusqu'ici. Une session ouverte par le serveur de rendu pour le compte d'un
 * navigateur porte l'agent de ce serveur — « node » — et l'afficher tel quel
 * ferait lire « node » à quelqu'un qui cherche son téléphone dans la liste.
 */
export type DeviceKind = "desktop" | "mobile" | "tool" | "unknown";

/**
 * Description d'un appareil, en morceaux plutôt qu'en phrase.
 *
 * La phrase — « Firefox sur Windows » — se compose dans l'interface, qui seule
 * connaît la langue du lecteur. Un libellé assemblé ici sortirait en français
 * sur un panel anglais, et resterait figé en base à la langue du jour de la
 * connexion.
 */
export interface DeviceDescription {
  /** Nom du navigateur, ou `null` si l'en-tête n'en désigne aucun de connu. */
  browser: string | null;
  /** Nom du système, ou `null` de même. */
  platform: string | null;
  /**
   * En-tête brut, tronqué, quand ni l'un ni l'autre n'est reconnaissable.
   *
   * Un en-tête méconnaissable vaut mieux affiché tel quel que remplacé : il
   * reste la seule chose qui distingue deux sessions, et quelqu'un qui cherche
   * une connexion suspecte a besoin de le voir.
   */
  raw: string | null;
  kind: DeviceKind;
}

/**
 * Navigateurs, dans l'ordre où il faut les tester.
 *
 * L'ordre compte plus que la liste : Edge et Opera contiennent « Chrome » dans
 * leur en-tête, Chrome contient « Safari ». Tester du plus spécifique au plus
 * générique est la seule façon de ne pas annoncer « Chrome » à quelqu'un qui
 * utilise Edge.
 */
const BROWSERS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\bEdgA?\//, name: "Edge" },
  { pattern: /\bOPR\/|\bOpera\//, name: "Opera" },
  { pattern: /\bSamsungBrowser\//, name: "Samsung Internet" },
  { pattern: /\bFirefox\/|\bFxiOS\//, name: "Firefox" },
  // Chrome sur iOS s'annonce « CriOS » et n'a pas de « Chrome/ » dans son
  // en-tête : sans cette ligne il serait rendu comme Safari.
  { pattern: /\bCriOS\//, name: "Chrome" },
  { pattern: /\bChrome\//, name: "Chrome" },
  { pattern: /\bSafari\//, name: "Safari" },
];

/**
 * Systèmes.
 *
 * Android avant Linux : un en-tête Android contient « Linux ». iPhone et iPad
 * avant Mac : Safari sur iPad annonce « Macintosh » depuis iPadOS 13.
 */
const PLATFORMS: readonly { pattern: RegExp; name: string; kind: DeviceKind }[] = [
  { pattern: /\bAndroid\b/, name: "Android", kind: "mobile" },
  { pattern: /\biPhone\b/, name: "iPhone", kind: "mobile" },
  { pattern: /\biPad\b/, name: "iPad", kind: "mobile" },
  // « Windows NT 10.0 » couvre Windows 10 et Windows 11 : Microsoft n'a pas
  // incrémenté le numéro. Annoncer « Windows 11 » serait une supposition, donc
  // le libellé s'arrête à « Windows ».
  { pattern: /\bWindows NT\b/, name: "Windows", kind: "desktop" },
  { pattern: /\bCrOS\b/, name: "ChromeOS", kind: "desktop" },
  { pattern: /\bMac OS X\b|\bMacintosh\b/, name: "macOS", kind: "desktop" },
  { pattern: /\bLinux\b|\bX11\b/, name: "Linux", kind: "desktop" },
];

/**
 * Agents qui sont **nos propres programmes**, et non un visiteur.
 *
 * Le navigateur ne parle jamais à l'API : il parle au serveur de rendu, qui
 * relaie l'agent réel. Quand ce relais manque — un chemin oublié, une version
 * antérieure à cette correction — l'API reçoit l'agent du `fetch` de Node, et
 * la session s'affichait alors sous le nom « node », à côté d'une adresse
 * `127.0.0.1`. Ce n'est pas un appareil : c'est la preuve que l'agent réel a
 * été perdu en route, et c'est ce qu'il faut dire.
 */
const OWN_RUNTIME = /^(node|undici|next\b|node-fetch)/i;

/**
 * Outils en ligne de commande et bibliothèques HTTP.
 *
 * Ceux-là sont de vrais appelants, mais pas des appareils : une clé d'API
 * employée par un script apparaît ainsi, et c'est exactement ce qu'il faut
 * lire. Le nom est conservé, tronqué à sa partie utile — « curl », pas
 * « curl/8.18.0 (x86_64-pc-linux-gnu) libcurl/8.18.0 … ».
 */
const TOOLS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /^curl\//i, name: "curl" },
  { pattern: /^Wget\//i, name: "Wget" },
  { pattern: /^python-requests\/|^httpx\/|^aiohttp\//i, name: "Python" },
  { pattern: /^Go-http-client\//i, name: "Go" },
  { pattern: /^PostmanRuntime\//i, name: "Postman" },
  { pattern: /^insomnia\//i, name: "Insomnia" },
  { pattern: /^axios\/|^okhttp\//i, name: "Bibliothèque HTTP" },
];

/** Au-delà, l'en-tête brut est tronqué avant d'être affiché. */
export const DEVICE_RAW_MAX = 120;

/** Décrit un appareil à partir de son en-tête. */
export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  const trimmed = userAgent?.trim();
  // Agent absent ou remplacé par le nôtre : dans les deux cas on ne sait pas
  // qui est à l'autre bout, et le prétendre serait pire que de l'avouer.
  if (!trimmed || OWN_RUNTIME.test(trimmed)) {
    return { browser: null, platform: null, raw: null, kind: "unknown" };
  }

  const tool = TOOLS.find((t) => t.pattern.test(trimmed));
  if (tool) return { browser: tool.name, platform: null, raw: null, kind: "tool" };

  const browser = BROWSERS.find((b) => b.pattern.test(trimmed))?.name ?? null;
  const platform = PLATFORMS.find((p) => p.pattern.test(trimmed)) ?? null;

  if (!browser && !platform) {
    return {
      browser: null,
      platform: null,
      raw: trimmed.slice(0, DEVICE_RAW_MAX),
      // Inconnu, mais pas perdu : l'en-tête est là et sera montré tel quel. Il
      // reste la seule chose qui distingue deux sessions inhabituelles.
      kind: "tool",
    };
  }

  return {
    browser,
    platform: platform?.name ?? null,
    raw: null,
    kind: platform?.kind ?? "desktop",
  };
}
