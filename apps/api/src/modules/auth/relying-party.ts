import type { Branding } from "@gamedashboard/contracts";
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

  return { name: PANEL_NAME, id: url.hostname, origin: url.origin, scope: null };
}

/**
 * Le domaine relais d'une cérémonie, selon le domaine d'arrivée.
 *
 * L'hôte vient d'un en-tête que l'appelant pourrait forger ; il n'est retenu
 * que s'il désigne un revendeur au domaine **vérifié** (`branding.resellerId`
 * n'est non nul que dans ce cas, voir `BrandingService.forHost`). Tout autre
 * hôte retombe sur `PANEL_ORIGIN`.
 *
 * Ce n'est pas rouvrir la porte que ferme `relyingPartyFromEnv` : le
 * navigateur inscrit l'origine réelle dans la réponse signée, et la
 * vérification l'exige égale à celle du domaine retenu. Une page sur
 * `evil.example` ne produit pas d'assertion pour `panel.revendeur.fr`, quel
 * que soit l'en-tête. Le seul pouvoir de l'en-tête est de choisir **parmi
 * les domaines du panel**, qui sont tous servis par lui.
 */
export function relyingPartyFor(
  host: string | null,
  branding: Pick<Branding, "name" | "resellerId">,
  env: NodeJS.ProcessEnv = process.env,
): RelyingParty {
  const scope = passkeyScope(host, branding);
  if (scope === null) return relyingPartyFromEnv(env);
  return { name: branding.name, id: scope, origin: `https://${scope}`, scope };
}

/**
 * Portée des clés d'accès pour un domaine d'arrivée : le domaine vérifié d'un
 * revendeur, ou `null` pour la plateforme.
 *
 * Séparée de `relyingPartyFor` parce qu'elle ne lit pas `PANEL_ORIGIN` :
 * savoir s'il faut proposer une clé à l'écran de connexion ne doit pas
 * dépendre d'un réglage que seule la cérémonie exige.
 */
export function passkeyScope(
  host: string | null,
  branding: Pick<Branding, "resellerId">,
): string | null {
  const hostname = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return branding.resellerId === null || hostname === "" ? null : hostname;
}
