import { isIP } from "node:net";

/**
 * Liste d'adresses autorisées pour une clé d'API.
 *
 * Chaque entrée est une adresse exacte ou un bloc CIDR (`203.0.113.0/24`,
 * `2001:db8::/32`). L'adresse présentée est normalisée avant comparaison : un
 * client IPv4 vu à travers une pile IPv6 arrive en `::ffff:203.0.113.7`, et
 * refuser cette forme alors que `203.0.113.7` est dans la liste rendrait la
 * restriction imprévisible selon le chemin réseau.
 */
export function ipAllowed(allowed: readonly string[], presented: string | null): boolean {
  if (allowed.length === 0) return true;
  if (presented === null) return false;

  const address = normalizeIp(presented);
  if (address === null) return false;

  return allowed.some((entry) => matchesEntry(entry.trim(), address));
}

/**
 * Vrai si l'entrée a une forme acceptable : adresse, ou adresse suivie d'un
 * préfixe. **La seule règle** de ce qu'une liste accepte : clés personnelles
 * et applicatives passent toutes par elle.
 *
 * Un préfixe nul est refusé (audit ASVS, NC-37) : `0.0.0.0/0` ou `::/0`
 * couvrent toutes les adresses, et une clé « restreinte » par eux s'ouvrirait
 * de partout en affichant une restriction.
 */
export function isAllowlistEntry(entry: string): boolean {
  const [ip, prefix, ...rest] = entry.trim().split("/");
  if (rest.length > 0 || !ip) return false;
  const version = isIP(ip);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 1 && bits <= (version === 4 ? 32 : 128);
}

function matchesEntry(entry: string, address: string): boolean {
  const [ip, prefix] = entry.split("/");
  if (!ip) return false;
  const base = normalizeIp(ip);
  if (base === null) return false;

  if (prefix === undefined) return base === address;

  const bits = Number(prefix);
  const left = toBits(base);
  const right = toBits(address);
  if (left === null || right === null || left.length !== right.length) return false;
  return left.slice(0, bits) === right.slice(0, bits);
}

/** IPv4 encapsulée ramenée à sa forme IPv4 ; IPv6 développée ; `null` si illisible. */
function normalizeIp(value: string): string | null {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(trimmed);
  if (mapped?.[1]) return isIP(mapped[1]) === 4 ? mapped[1] : null;
  const version = isIP(trimmed);
  if (version === 4) return trimmed;
  if (version === 6) return expandIpv6(trimmed);
  return null;
}

function toBits(address: string): string | null {
  if (isIP(address) === 4) {
    return address
      .split(".")
      .map((part) => Number(part).toString(2).padStart(8, "0"))
      .join("");
  }
  const expanded = expandIpv6(address);
  if (expanded === null) return null;
  return expanded
    .split(":")
    .map((group) => Number.parseInt(group, 16).toString(2).padStart(16, "0"))
    .join("");
}

/** `2001:db8::1` → huit groupes de quatre chiffres hexadécimaux. */
function expandIpv6(address: string): string | null {
  let value = address;
  // Une IPv4 en queue d'IPv6 (`::ffff:1.2.3.4` hors forme normalisée) est
  // convertie en deux groupes hexadécimaux.
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (tail?.[1] && tail[2]) {
    const octets = tail[2].split(".").map(Number);
    const hex = octets.map((o) => o.toString(16).padStart(2, "0"));
    value = `${tail[1]}${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...rest];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.padStart(4, "0")).join(":");
}
