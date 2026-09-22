"use server";

import { LOCALE_COOKIE } from "@gamedashboard/i18n";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { apiSend } from "./client";

/**
 * Langue du compte, et cookie qui la reflète.
 *
 * Les deux écritures comptent, et pour des raisons différentes. La base porte
 * la préférence de **la personne** : elle la retrouve sur son téléphone, et
 * après un nettoyage de navigateur. Le cookie, lui, est ce que lit le rendu
 * côté serveur à l'instant où il fabrique la page — avant toute session, et
 * sans aller interroger l'API à chaque requête.
 *
 * L'ordre est délibéré : l'API d'abord, le cookie ensuite. Poser le cookie
 * avant ferait changer la langue de l'écran alors que l'enregistrement a
 * échoué, et la préférence reviendrait en arrière au prochain appareil.
 */
export async function setAccountLocale(locale: string): Promise<{ error: string | null }> {
  try {
    await apiSend("/api/v1/client/account/locale", { locale });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Langue refusée." };
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    // Un an : c'est une préférence, pas une session. Elle n'a rien de secret
    // et n'ouvre aucun accès.
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
  });

  // Toute la coquille est traduite : c'est la mise en page entière qu'il faut
  // refabriquer, pas seulement l'écran courant.
  revalidatePath("/", "layout");
  return { error: null };
}

export async function setAccountTimezone(timezone: string): Promise<{ error: string | null }> {
  try {
    await apiSend("/api/v1/client/account/timezone", { timezone });
    revalidatePath("/", "layout");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Fuseau refusé." };
  }
}
