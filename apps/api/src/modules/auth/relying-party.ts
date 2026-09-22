import type { RelyingParty } from "./passkey.service";

/** Nom affiché par les applications d'authentification et par le navigateur. */
export const PANEL_NAME = "GameDashboard";

export class MissingPanelOriginError extends Error {
  constructor(value: string) {
    super(
      `PANEL_ORIGIN doit être une URL absolue pour les clés d'accès ; reçu « ${value} ». ` +
        "Exemple : https://game.example.fr",
    );
    this.name = "MissingPanelOriginError";
  }
}

/**
 * Le domaine relais des cérémonies WebAuthn.
 *
 * Lu dans `PANEL_ORIGIN`, **jamais dans la requête**, et c'est le point
 * important de ce fichier. L'API est appelée par le rendu serveur de Next, pas
 * par le navigateur : son en-tête `Host` vaut `127.0.0.1:3201` et ne dit rien
 * de l'endroit où la cérémonie s'est réellement déroulée. Surtout, accepter une
 * origine annoncée par l'appelant reviendrait à désactiver la protection
 * centrale de WebAuthn contre l'hameçonnage : une assertion obtenue sur
 * `evil.example` serait vérifiée contre `evil.example` et acceptée.
 *
 * Le `rpID` est le domaine seul — ni schéma ni port — comme l'exige la
 * spécification, et il est signé par l'authentifiant : le changer invalide
 * toutes les clés déjà enregistrées.
 */
export function relyingPartyFromEnv(env: NodeJS.ProcessEnv = process.env): RelyingParty {
  const raw = env.PANEL_ORIGIN ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MissingPanelOriginError(raw);
  }

  return { name: PANEL_NAME, id: url.hostname, origin: url.origin };
}
