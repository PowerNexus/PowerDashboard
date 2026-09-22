import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Refus des destinations internes pour tout ce que le panel appelle sur
 * demande d'un tiers : rappels sortants, adresses saisies par un client.
 *
 * Le panel tourne sur un réseau qui contient des choses qu'un visiteur ne
 * doit pas atteindre — l'API sur la boucle locale, les nodes, un service de
 * métadonnées chez certains hébergeurs. Une adresse « publique » à l'écran
 * peut résoudre vers l'un d'eux : c'est le nom qu'il faut résoudre, pas
 * seulement le lire.
 *
 * Le contrôle est fait au moment de l'enregistrement. Une résolution qui
 * changerait ensuite (rebinding DNS) n'est pas couverte : la protection
 * réelle contre ce cas est que le panel ne rend jamais le corps de la réponse
 * d'un rappel, seulement son code.
 */
export async function assertPublicDestination(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new PrivateDestinationError(host);
  }

  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((entries) => entries.map((entry) => entry.address))
        .catch(() => []);

  // Un nom qui ne résout pas est refusé aussi : un rappel vers nulle part ne
  // partirait jamais, autant le dire tout de suite.
  if (addresses.length === 0) throw new PrivateDestinationError(host);

  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new PrivateDestinationError(host);
  }
}

export class PrivateDestinationError extends Error {
  constructor(host: string) {
    super(`« ${host} » désigne une adresse interne ou introuvable.`);
    this.name = "PrivateDestinationError";
  }
}

/** Plages qui ne sont jamais une destination légitime depuis le panel. */
export function isPrivateAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true; // ce réseau, privé, boucle
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // lien local et métadonnées
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast et réservé
    return false;
  }

  const v6 = address.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  // IPv4 encapsulée : on juge l'adresse IPv4 qu'elle porte.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  if (/^f[cd]/.test(v6)) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(v6)) return true; // lien local fe80::/10
  return false;
}
