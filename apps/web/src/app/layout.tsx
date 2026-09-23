import { DEFAULT_BRANDING } from "@gamedashboard/contracts";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { BetaNotice } from "@/components/beta-notice";
import { BrandingProvider } from "@/components/branding-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { SplashGate } from "@/components/splash-gate";
import { getBranding } from "@/server/api/branding";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "swap" });

/**
 * Les métadonnées suivent la langue de la requête : `generateMetadata` plutôt
 * qu'un objet constant, sinon le titre de l'onglet resterait en français pour
 * un utilisateur anglophone.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  // Le nom de l'onglet suit le domaine d'arrivée : un client d'un revendeur ne
  // doit pas retrouver « GameDashboard » dans sa barre de favoris après s'être
  // connecté chez lui.
  const branding = await getBranding();
  return {
    title: { default: branding.name, template: `%s · ${branding.name}` },
    description: t("description"),
    icons: { icon: "/brand/favicon" },
  };
}

/**
 * Décline la couleur d'accent en la rampe attendue par les composants.
 *
 * Un revendeur donne **une** couleur ; l'interface en emploie trois — un ton
 * clair, un ton plein, un ton foncé. Le calcul est laissé au navigateur avec
 * `color-mix` plutôt que fait ici : une teinte mélangée côté serveur serait
 * figée, et se calculerait à nouveau à chaque rendu pour un résultat identique.
 */
function accentStyle(accent: string): string {
  if (accent === DEFAULT_BRANDING.accent) return "";
  return `:root{--gd-accent-500:${accent};--gd-accent-400:color-mix(in srgb, ${accent} 82%, white);--gd-accent-600:color-mix(in srgb, ${accent} 85%, black)}`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // `lang` doit refléter la langue réellement rendue : les lecteurs d'écran
  // s'en servent pour choisir leur prononciation, et un `lang="fr"` sur du
  // texte anglais le rend incompréhensible à l'oral.
  const locale = await getLocale();
  const branding = await getBranding();
  const accent = accentStyle(branding.accent);
  // Le nonce de la requête (`proxy.ts`) : Next le pose de lui-même sur ses
  // scripts, pas sur une balise écrite à la main comme celle du thème.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <style>{`:root{--gd-font-sans:var(--font-inter),ui-sans-serif,system-ui,sans-serif;--gd-font-mono:var(--font-mono-jb),ui-monospace,monospace}`}</style>
        {/*
         * La couleur du revendeur, posée avant la première peinture.
         *
         * Dans l'en-tête et non dans une feuille chargée ensuite : sinon
         * l'interface s'afficherait une fraction de seconde en violet GameDashboard
         * avant de prendre la teinte du revendeur, ce qui se voit.
         *
         * La valeur est une couleur hexadécimale vérifiée à l'enregistrement —
         * sans ce contrôle, ce point d'insertion accepterait une déclaration
         * entière, et la feuille de style appartiendrait à qui remplit le champ.
         */}
        {accent === "" ? null : <style>{accent}</style>}
        {/*
         * Le thème est appliqué avant la première peinture, pour éviter que la
         * page apparaisse en clair puis bascule en sombre.
         *
         * **Un script externe, et non son code posé ici.** Les trois formes
         * en ligne ont été essayées, et React 19 avertit pour les trois —
         * « Encountered a script tag while rendering React component » : le
         * code en enfant, `dangerouslySetInnerHTML`, et `next/script` en
         * `beforeInteractive`, qui finit par produire l'une des deux. C'est un
         * faux positif — le script s'exécute bien, au rendu serveur — mais il
         * s'écrit dans la console à chaque chargement, et une console qui crie
         * à tort finit par ne plus être lue.
         *
         * `/gd-theme.js` est une route qui rend la constante du design system :
         * une seule vérité, partagée avec la bascule de thème qui lit la même
         * clé de stockage.
         *
         * Ni `defer` ni `async` : c'est ce qui le fait s'exécuter **avant** la
         * peinture, donc avant que la page puisse apparaître dans le mauvais
         * thème.
         *
         * Dans `<head>` et non entre `<head>` et `<body>` : le HTML n'autorise
         * que ces deux enfants sous `<html>`, et une balise posée entre les
         * deux produit une erreur d'hydratation.
         *
         * Avec son nonce : sous la CSP stricte, un script sans nonce ne
         * s'exécute pas, même servi par le panel lui-même.
         */}
        <script src="/gd-theme.js" nonce={nonce} />
      </head>
      <body>
        {/*
         * Écran de démarrage, tenu le temps que l'animation de marque se
         * joue en entier. Il couvre la page plutôt que de la remplacer : le
         * contenu se rend derrière, et se découvre au fondu.
         */}
        <SplashGate name={branding.name} />
        {/*
         * L'agent de service, pour que le panel s'installe comme une
         * application. Il ne met aucune page ni aucune réponse d'API en
         * cache — le détail est dans `public/sw.js`, et la raison est qu'un
         * panel authentifié ne doit rien resservir à qui vient après.
         */}
        <ServiceWorkerRegistrar />
        <BrandingProvider branding={branding}>
          <NextIntlClientProvider>
            {/*
             * L'avertissement de bêta, une fois par navigateur.
             *
             * Dans le fournisseur de traductions et non au-dessus : il porte
             * du texte, et la coquille traduit. Posé avant `children` pour
             * qu'il soit monté quelle que soit la page d'arrivée — un
             * avertissement qui ne s'afficherait qu'une fois connecté
             * manquerait ceux qui hésitent devant l'écran de connexion.
             */}
            <BetaNotice />
            {children}
          </NextIntlClientProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
