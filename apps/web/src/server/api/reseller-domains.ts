"use server";

import { apiFetch } from "./client";

/** Un domaine propre déclaré par un revendeur, vérifié ou non. */
export interface ResellerDomain {
  userId: string;
  email: string;
  domain: string;
  verifiedAt: string | null;
  /**
   * L'état du certificat, tel que l'agent l'a rapporté.
   *
   * Les quatre champs sont indépendants, et leur **combinaison** porte le
   * sens : un certificat délivré **et** un échec veulent dire qu'un
   * renouvellement a échoué alors que l'ancien tient encore — le moment précis
   * où il faut agir, et celui qu'un seul champ « état » aurait écrasé.
   */
  certificateIssuedAt: string | null;
  certificateExpiresAt: string | null;
  certificateAttemptedAt: string | null;
  certificateFailure: string | null;
}

export const fetchResellerDomains = async (): Promise<ResellerDomain[]> => {
  const { data } = await apiFetch<{ data: ResellerDomain[] }>("/api/v1/admin/reseller-domains");
  return data;
};
