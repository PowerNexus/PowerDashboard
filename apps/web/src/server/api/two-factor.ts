"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { apiFetch, apiSend, apiSendFor } from "./client";

export interface TwoFactorStatus {
  /** Vrai dès qu'une seconde preuve est exigée : TOTP **ou** clé d'accès. */
  enabled: boolean;
  /** Un secret TOTP préparé mais jamais confirmé. Rien n'est exigé à la connexion. */
  pending: boolean;
  /** Vrai quand un secret TOTP confirmé est en place. */
  totp: boolean;
  /** Nombre de clés d'accès enregistrées. */
  passkeys: number;
  remainingRecoveryCodes: number;
  enabledAt: string | null;
  /**
   * La plateforme l'exige-t-elle de **ce** compte ?
   *
   * Rendu par l'API plutôt que déduit du réglage : celui-ci vit dans l'espace
   * d'administration, dont l'accès est précisément ce que l'exigence
   * conditionne. Un écran qui irait le lire se heurterait au refus qu'il
   * cherche à expliquer.
   */
  required: boolean;
}

export interface TwoFactorSetup {
  /** Secret en base32, à recopier quand la caméra ne veut rien savoir. */
  secret: string;
  /** URI `otpauth:`, cliquable : sur téléphone, elle ouvre l'application. */
  uri: string;
  /**
   * QR code en SVG, encodé en data URI.
   *
   * Dessiné **sur le serveur** : la bibliothèque d'encodage reste hors du
   * paquet envoyé au navigateur, et le secret n'a pas à être manipulé par du
   * JavaScript de page pour être affiché. SVG plutôt que PNG, pour rester net
   * sur un écran à forte densité comme à l'impression.
   */
  qrSvg: string;
}

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  const { data } = await apiFetch<{ data: TwoFactorStatus }>("/api/v1/auth/2fa");
  return data;
}

export async function beginTwoFactorSetup(): Promise<{
  setup: TwoFactorSetup | null;
  error: string | null;
}> {
  try {
    const { data } = await apiSendFor<{ data: { secret: string; uri: string } }>(
      "/api/v1/auth/2fa/setup",
      undefined,
    );
    return { setup: { ...data, qrSvg: await renderQr(data.uri) }, error: null };
  } catch (error) {
    return { setup: null, error: message(error) };
  }
}

/**
 * Dessine le QR code.
 *
 * Correction d'erreur au niveau « M » : un QR code lu à l'écran n'est ni sali
 * ni plié, et monter plus haut densifierait la grille sans rien gagner —
 * au risque qu'une caméra médiocre n'en vienne plus à bout.
 */
async function renderQr(uri: string): Promise<string> {
  const svg = await QRCode.toString(uri, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    // Les couleurs sont figées en noir sur blanc : un QR code doit garder son
    // contraste, y compris quand la page est en thème sombre. La carte qui
    // l'entoure lui donne son fond blanc.
    color: { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Confirme la préparation et rend les codes de secours.
 *
 * C'est la seule fois où ils sortent en clair : seul leur condensat est
 * conservé. L'écran doit donc les montrer maintenant, ou jamais.
 */
export async function enableTwoFactor(code: string): Promise<{
  recoveryCodes: string[] | null;
  error: string | null;
}> {
  try {
    const { data } = await apiSendFor<{ data: { recoveryCodes: string[] } }>(
      "/api/v1/auth/2fa/enable",
      { code },
    );
    revalidatePath("/account/security");
    return { recoveryCodes: data.recoveryCodes, error: null };
  } catch (error) {
    return { recoveryCodes: null, error: message(error) };
  }
}

export async function resetRecoveryCodes(password: string): Promise<{
  recoveryCodes: string[] | null;
  error: string | null;
}> {
  try {
    const { data } = await apiSendFor<{ data: { recoveryCodes: string[] } }>(
      "/api/v1/auth/2fa/recovery-codes",
      { password },
    );
    revalidatePath("/account/security");
    return { recoveryCodes: data.recoveryCodes, error: null };
  } catch (error) {
    return { recoveryCodes: null, error: message(error) };
  }
}

export async function disableTwoFactor(password: string): Promise<{ error: string | null }> {
  try {
    await apiSend("/api/v1/auth/2fa", { password }, "DELETE");
    revalidatePath("/account/security");
    return { error: null };
  } catch (error) {
    return { error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Opération refusée.";
}
