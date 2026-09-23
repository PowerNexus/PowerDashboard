import { BlockList, isIP } from "node:net";
import { describeUserAgent } from "@gamedashboard/contracts";

/**
 * D'où vient une connexion, sous la forme qui sert à la **comparer** (§5.1).
 *
 * L'alerte « nouvel appareil » ne cherche pas à identifier une machine — un
 * agent se falsifie, une adresse change à chaque box redémarrée. Elle cherche
 * à reconnaître l'habituel : le même navigateur sur le même système, depuis le
 * même réseau. Tout ce qui sort de là mérite un courriel, et c'est au titulaire
 * de dire si c'était lui.
 *
 * Rien ici ne touche à la base ni au réseau : ce sont les règles qu'on se
 * trompe d'un octet, et qu'un test doit tenir sans rien démarrer.
 */

/** Ce qu'on compare d'une connexion à l'autre. */
export interface SignInFingerprint {
  /** Famille d'appareil : navigateur et système, sans numéro de version. */
  device: string;
  /** Réseau : /24 en IPv4, /48 en IPv6. `null` quand l'adresse manque. */
  network: string | null;
}

/**
 * Famille d'appareil tirée de l'agent.
 *
 * **Sans version**, et c'est tout l'intérêt : Firefox se met à jour toutes les
 * quatre semaines, et une empreinte qui changerait avec lui ferait partir une
 * alerte par mois à chaque utilisateur — le meilleur moyen de faire classer
 * les suivantes sans les lire.
 */
export function deviceFamily(userAgent: string | null | undefined): string {
  const described = describeUserAgent(userAgent);
  if (described.kind === "unknown") return "unknown";
  if (described.raw) return `raw:${described.raw}`;
  return `${described.browser ?? "-"}/${described.platform ?? "-"}`;
}

/**
 * Réseau d'une adresse : /24 en IPv4, /48 en IPv6.
 *
 * L'adresse exacte serait trop fine — un fournisseur d'accès en réattribue à
 * chaque reconnexion, et l'alerte deviendrait du bruit. Le /24 reste chez le
 * même opérateur, dans la même ville le plus souvent ; le /48 est ce qu'un
 * opérateur attribue d'ordinaire à un seul site client en IPv6.
 */
export function networkOf(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const address = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  // Une IPv4 vue à travers une pile IPv6 est la même IPv4 : la traiter comme
  // une IPv6 ferait paraître nouveau un réseau déjà connu.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  const plain = mapped?.[1] ?? address;

  if (isIP(plain) === 4) {
    const [a, b, c] = plain.split(".");
    return `${a}.${b}.${c}.0/24`;
  }
  if (isIP(plain) === 6) {
    const groups = expandIpv6(plain);
    if (!groups) return null;
    return `${groups.slice(0, 3).join(":")}::/48`;
  }
  return null;
}

/** Les huit groupes d'une IPv6, sans zéros de tête. `null` si illisible. */
function expandIpv6(address: string): string[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const split = (part: string | undefined): string[] => {
    if (!part) return [];
    const groups = part.split(":");
    // Une IPv4 en queue (`64:ff9b::192.0.2.1`) occupe deux groupes. Seuls les
    // trois premiers comptent pour le réseau : leur valeur n'importe pas ici.
    const last = groups.at(-1);
    if (last?.includes(".")) groups.splice(-1, 1, "0", "0");
    return groups;
  };

  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

  return [...head, ...Array<string>(missing).fill("0"), ...tail].map((group) =>
    Number.parseInt(group, 16).toString(16),
  );
}

/** Même défaut que `main.ts` : la boucle locale, d'où parlent nginx et le rendu. */
const DEFAULT_TRUSTED_PROXIES = "127.0.0.1, ::1";

/** Valeur de `TRUSTED_PROXIES`, lue au même endroit pour Fastify et pour le pays. */
export function trustedProxiesSetting(): string {
  return process.env.TRUSTED_PROXIES ?? DEFAULT_TRUSTED_PROXIES;
}

/**
 * Noms de plages que Fastify accepte dans `trustProxy` (ceux de `proxy-addr`).
 *
 * Repris ici pour que la même valeur de `TRUSTED_PROXIES` veuille dire la même
 * chose aux deux endroits qui la lisent : une liste qui ferait confiance à
 * `loopback` pour l'adresse et pas pour le pays serait un piège de réglage.
 */
const NAMED_RANGES: Record<string, readonly string[]> = {
  loopback: ["127.0.0.1/8", "::1/128"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  uniquelocal: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
};

/** Vrai quand l'interlocuteur **direct** de l'API figure dans la liste de confiance. */
export function isTrustedPeer(peer: string | null | undefined, setting: string): boolean {
  if (!peer) return false;
  const address = peer.trim().replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i, "$1");
  const family = isIP(address);
  if (family === 0) return false;

  const list = new BlockList();
  for (const raw of setting.split(",")) {
    const entry = raw.trim().toLowerCase();
    if (entry === "") continue;
    for (const range of NAMED_RANGES[entry] ?? [entry]) {
      const [base = "", prefix] = range.split("/");
      const version = isIP(base);
      if (version === 0) continue;
      const type = version === 4 ? "ipv4" : "ipv6";
      if (prefix === undefined) list.addAddress(base, type);
      else list.addSubnet(base, Number(prefix), type);
    }
  }
  return list.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * En-tête de pays posé par le frontal — celui de Cloudflare.
 *
 * Il n'y a pas de base GeoIP dans le panel, et l'on ne prétend donc connaître
 * le pays **que** lorsqu'un intermédiaire l'a dit.
 */
export const COUNTRY_HEADER = "cf-ipcountry";

/**
 * Pays de la connexion, ou `null` quand on ne peut pas le croire.
 *
 * L'en-tête n'est lu que si la requête arrive d'un intermédiaire de
 * `TRUSTED_PROXIES` : joint directement, l'API recevrait le pays que
 * l'appelant a bien voulu écrire. `XX` est la réponse de Cloudflare pour
 * « inconnu », et les codes non alphabétiques (`T1` pour Tor) ne sont pas des
 * pays : dans les deux cas on se tait plutôt que d'afficher un faux pays.
 */
export function trustedCountry(
  headers: Record<string, string | string[] | undefined>,
  peer: string | null | undefined,
  setting: string,
): string | null {
  if (!isTrustedPeer(peer, setting)) return null;
  const raw = headers[COUNTRY_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(value) || value === "XX") return null;
  return value;
}

/**
 * Verdict sur une connexion réussie.
 *
 * - `first` : le compte n'a jamais eu de session. Prévenir quelqu'un qu'il
 *   vient de se connecter depuis « un nouvel appareil » le jour où il crée son
 *   compte ne lui apprend rien, et lui apprend surtout à ignorer ce courriel.
 * - `known` : ce couple appareil + réseau a déjà ouvert une session, et le
 *   pays, s'il est connu, a déjà été vu.
 * - `new` : tout le reste.
 *
 * Le pays ne compte que si l'historique en porte au moins un. Le jour où
 * l'en-tête de pays apparaît — un frontal Cloudflare ajouté devant le panel —
 * aucun compte n'a encore de pays connu, et tous recevraient d'un coup une
 * alerte de « nouveau pays » qui ne dirait rien de vrai.
 */
export function assessSignIn(
  history: readonly SignInFingerprint[],
  knownCountries: readonly string[],
  current: SignInFingerprint & { country: string | null },
): "first" | "known" | "new" {
  if (history.length === 0) return "first";

  const seen = history.some(
    (entry) => entry.device === current.device && entry.network === current.network,
  );
  const newCountry =
    current.country !== null &&
    knownCountries.length > 0 &&
    !knownCountries.includes(current.country);

  return seen && !newCountry ? "known" : "new";
}
