/**
 * Politique de sécurité de contenu (PLAN §5.4 : « CSP stricte (nonce) »).
 *
 * **Les scripts ne passent que par le nonce.** Un nonce neuf est tiré à
 * chaque requête (`proxy.ts`) ; Next le lit dans cet en-tête et le pose sur
 * ses propres scripts, en ligne comme externes. Un script injecté dans la
 * page — la faille XSS que la CSP est là pour contenir — ne le connaît pas et
 * ne s'exécute pas. Avant, `'unsafe-inline'` laissait passer n'importe quel
 * script en ligne : la CSP ne protégeait les scripts de rien.
 *
 * `'strict-dynamic'` étend la confiance aux scripts qu'un script de confiance
 * charge lui-même : c'est ainsi que passent Turnstile (`next/script`, injecté
 * par Next) et les morceaux que Next charge à la demande, Monaco compris. Un
 * navigateur qui comprend `'strict-dynamic'` ignore alors `'self'` et les
 * hôtes de la liste ; ils restent pour ceux qui ne le comprennent pas.
 *
 * **Aucun CDN** (NC-22). Monaco se chargeait depuis `cdn.jsdelivr.net`, sans
 * empreinte d'intégrité, et ce CDN figurait ici en `script-src`, `style-src`
 * et `font-src` : sa compromission exécutait un script dans le panel. Monaco
 * est désormais compilé avec l'interface (`lib/monaco.ts`) : scripts, styles
 * et police codicon viennent de `/_next/static`, sous `'self'`.
 *
 * Ce que chaque autre source autorise, et pourquoi elle est là :
 * - `worker-src 'self' blob:` : les workers de Monaco sont des fichiers du
 *   panel, créés en module ; `blob:` reste pour ceux qu'il enveloppe.
 * - `challenges.cloudflare.com` : Turnstile, un script et un cadre.
 * - `connect-src https: wss:` : la console et les envois de fichiers parlent
 *   **directement** aux nodes Wings, dont les hôtes sont ceux que l'admin
 *   déclare — impossible de les énumérer ici.
 * - `img-src https:` : logos et favicons des revendeurs, hébergés chez eux.
 * - `style-src 'unsafe-inline'` : React pose des attributs `style`, et la
 *   couleur du revendeur est une feuille en ligne. Un style injecté ne
 *   s'exécute pas ; le risque n'a rien de commun avec celui des scripts.
 * - En développement, React a besoin d'`eval` pour ses piles d'erreurs, et
 *   Turbopack d'un websocket en clair.
 */
export function contentSecurityPolicy(nonce: string, production: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https: wss:${production ? "" : " http: ws:"}`,
    "worker-src 'self' blob:",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Un nonce : 128 bits tirés par le générateur cryptographique, en base64.
 *
 * Imprévisible et jamais réutilisé, sinon il ne protège rien : qui peut le
 * deviner peut signer son propre script.
 */
export function newNonce(): string {
  const octets = new Uint8Array(16);
  crypto.getRandomValues(octets);
  return btoa(String.fromCharCode(...octets));
}
