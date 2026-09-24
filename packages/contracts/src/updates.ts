/**
 * État de la mise à jour autonome, tel que l'administration le lit
 * (`GET /api/v1/admin/updates`). Hors d'un hébergement autonome, seul
 * `actif: false` est rendu : la carte ne s'affiche pas.
 */
export type UpdateStatus =
  | { actif: false }
  | {
      actif: true;
      /** Version de l'API qui répond. */
      version: string;
      enService: string;
      precedente: string | null;
      derniereVerification: string | null;
      /** Dernière release publiée, vue à la dernière vérification. */
      derniereRelease: string | null;
      /** Mise à jour en cours, et son étape. */
      operation: { etape: UpdateStep; version: string; depuis: string } | null;
      dernierResultat: {
        etat: "installee" | "refusee" | "erreur";
        version: string;
        message?: string;
        date: string;
      } | null;
      refusees: string[];
    };

export type UpdateStep = "telechargement" | "extraction" | "repetition" | "bascule";
