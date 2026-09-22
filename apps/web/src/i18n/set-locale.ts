"use server";

import { isLocale, LOCALE_COOKIE } from "@gamedashboard/i18n";
import { cookies } from "next/headers";

/**
 * Change la langue depuis le sélecteur.
 *
 * La valeur est validée avant d'être écrite : un cookie se modifie depuis le
 * navigateur, et une valeur arbitraire ne doit jamais atteindre le chargement
 * des catalogues.
 *
 * Quand les comptes existeront, ce choix devra aussi être enregistré sur le
 * profil : le cookie ne suit pas l'utilisateur d'une machine à l'autre.
 */
export async function setLocale(value: string): Promise<void> {
  if (!isLocale(value)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // Pas de HttpOnly : ce cookie ne porte aucun secret, et le client doit
    // pouvoir le lire pour afficher la langue courante sans aller-retour.
    httpOnly: false,
  });
}
