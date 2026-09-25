/**
 * L'appel réseau commun aux trois facturiers.
 *
 * Tenu ici plutôt que dans chaque implémentation : le délai, le refus de
 * l'`http` en clair et la lecture d'une réponse illisible ne doivent pas
 * dépendre du facturier choisi, et trois copies finiraient par diverger.
 */

const FETCH_TIMEOUT_MS = 6_000;

/**
 * Le facturier a répondu, mais pour refuser — clé invalide, adresse IP non
 * autorisée, appel inconnu.
 *
 * Distinct d'une panne réseau pour le journal et pour l'essai de connexion de
 * l'administration, où la phrase du facturier est la seule chose exploitable.
 */
export class BillingRefusal extends Error {}

/**
 * Vérifie que l'adresse est en `https`.
 *
 * La clé part dans chaque requête : en clair sur le réseau si l'adresse n'est
 * pas chiffrée. Une erreur de saisie ne doit pas la publier.
 */
export function assertHttps(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new BillingRefusal("L'adresse de l'API de facturation est illisible.");
  }
  if (parsed.protocol !== "https:") {
    throw new BillingRefusal("L'adresse de l'API de facturation doit être en https.");
  }
  return parsed;
}

/**
 * Un formulaire en `POST`, réponse JSON.
 *
 * Les identifiants voyagent dans le **corps** et non dans l'adresse : une clé
 * d'API en paramètre d'URL finirait dans les journaux du serveur, dans ceux du
 * proxy, et dans tout ce qui se trouve entre les deux.
 */
export async function postForm(
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const target = assertHttps(url);
  return readJson(
    await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  );
}

/** Un `GET` JSON avec un jeton porteur, dans l'en-tête. */
export async function getWithBearer(url: URL, token: string): Promise<Record<string, unknown>> {
  assertHttps(url.toString());
  return readJson(
    await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 401 || response.status === 403) {
    throw new BillingRefusal(`Le facturier a refusé la clé (${response.status}).`);
  }
  if (!response.ok) throw new Error(`Le facturier a répondu ${response.status}.`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Réponse du facturier illisible.");
  }
  const record = asRecord(payload);
  if (!record) throw new Error("Réponse du facturier illisible.");
  return record;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asText(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Un identifiant, qu'il arrive en nombre ou en chaîne. */
export function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
