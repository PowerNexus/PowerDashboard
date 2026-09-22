"use client";

import { type Branding, DEFAULT_BRANDING } from "@gamedashboard/contracts";
import { createContext, type ReactNode, useContext } from "react";

/**
 * Marque servie, mise à disposition des composants client.
 *
 * Le logo et le favicon passent par des routes qui savent d'où vient la
 * requête ; le **nom**, lui, est du texte et doit voyager. Un contexte plutôt
 * qu'une propriété traversant dix composants : l'en-tête, le pied de page et
 * les écrans de connexion l'affichent tous, et aucun n'est parent des autres.
 *
 * La valeur est posée une fois par le gabarit racine, qui est un composant
 * serveur : elle est donc déjà là au premier rendu, sans scintillement.
 */
const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({
  branding,
  children,
}: {
  branding: Branding;
  children: ReactNode;
}) {
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
