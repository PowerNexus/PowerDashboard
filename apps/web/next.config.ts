import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Politique de sécurité de contenu.
 *
 * Ce que chaque source autorise, et pourquoi elle est là :
 * - `cdn.jsdelivr.net` : Monaco, que `@monaco-editor/react` charge depuis ce
 *   CDN par défaut (scripts, feuilles de style, police codicon). Ses workers
 *   sont des `blob:`.
 * - `challenges.cloudflare.com` : Turnstile, un script et un cadre.
 * - `connect-src https: wss:` : la console et les envois de fichiers parlent
 *   **directement** aux nodes Wings, dont les hôtes sont ceux que l'admin
 *   déclare — impossible de les énumérer ici.
 * - `img-src https:` : logos et favicons des revendeurs, hébergés chez eux.
 * - `'unsafe-inline'` sur les scripts : Next injecte ses scripts d'amorçage
 *   en ligne ; les retirer demande un nonce posé par un middleware, qui n'est
 *   pas encore en place. `object-src 'none'` et `base-uri 'self'` ferment
 *   les contournements classiques en attendant.
 * - En développement, Turbopack a besoin d'`eval` et d'un websocket en clair.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://cdn.jsdelivr.net https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  `connect-src 'self' https: wss:${isProduction ? "" : " http: ws:"}`,
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Le panel n'est jamais encadré : redondant avec `frame-ancestors`, pour
  // les navigateurs qui ne lisent pas la CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Les URL `/reset?token=` ne doivent pas partir en Referer vers les logos
  // des revendeurs ni vers un lien externe.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // HSTS est posé par nginx, qui termine TLS : ici il ne s'appliquerait pas
  // en développement et ferait doublon en production.
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  transpilePackages: ["@gamedashboard/ui", "@gamedashboard/contracts", "@gamedashboard/i18n"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Turbopack est le bundler par défaut depuis Next 16. Déclarer la section,
  // même vide, vaut adhésion explicite : sans elle, une configuration webpack
  // résiduelle ferait échouer le build avec un avertissement de migration.
  turbopack: {},
  /*
   * Pas de `watchOptions: { pollIntervalMs }` ici, et c'est voulu.
   *
   * Le dépôt a vécu sur `/mnt/c`, servi à WSL par le montage `drvfs`, qui
   * n'émet aucun événement `inotify` : le rechargement à chaud n'y fonctionnait
   * pas, et rien ne le signalait — Turbopack ne se plaint pas d'un veilleur
   * muet, il attend. L'erreur qu'on finissait par lire accusait le code, sur
   * un export pourtant bien présent, parce que le graphe de modules datait du
   * démarrage du serveur.
   *
   * Le sondage est la réponse habituelle à ce montage. Il a été essayé et il ne
   * marchait pas : page ouverte dans le navigateur, son propre fichier touché,
   * aucune recompilation. Le veilleur à sondage de Turbopack tentait de
   * surveiller des chemins qui n'existent pas sur le disque — l'espace virtuel
   * `.next-internal`, les `node_modules` de la racine que pnpm n'y place pas —
   * et déversait un `watch error` par chemin dans la console, c'est-à-dire là
   * où l'on lit les vraies erreurs.
   *
   * Le dépôt a donc déménagé dans le système de fichiers de WSL, où `inotify`
   * fonctionne nativement. Le réglage n'a plus d'objet ; le réintroduire le
   * jour où le rechargement à chaud rate quelque chose reviendrait à refaire ce
   * chemin à l'envers.
   */
};

// Sans argument, le plugin cherche `src/i18n/request.ts`.
export default createNextIntlPlugin()(config);
