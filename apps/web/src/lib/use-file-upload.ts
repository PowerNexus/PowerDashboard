"use client";

import { useCallback, useRef, useState } from "react";
import {
  type EnvoiProgres,
  envoiDirect,
  envoiReprenable,
  type IssueEnvoi,
  PETIT_FICHIER,
} from "./file-upload";

/**
 * Envoi des fichiers choisis, annulable.
 *
 * **Petit fichier : droit au daemon.** Le panel ne voit passer que
 * l'autorisation — une adresse et un jeton à usage unique — et le navigateur
 * dépose chez Wings.
 *
 * **Gros fichier : découpé, et repris s'il le faut.** Les morceaux vont au
 * panel, qui les garde et les recolle — le daemon ne sachant pas compléter un
 * fichier déjà commencé.
 *
 * Le dossier courant part en paramètre dans les deux cas : c'est là qu'on se
 * trouve, et c'est là que le fichier doit atterrir.
 *
 * `annuler` arrête l'envoi en cours **et les suivants** de la même sélection :
 * qui annule au milieu de dix fichiers ne veut pas voir partir les neuf autres.
 */
export function useFileUpload(options: {
  serverId: string;
  path: string;
  echec: string;
  onError: (message: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const { serverId, path, echec, onError, onDone } = options;
  const [uploading, setUploading] = useState(false);
  const [progres, setProgres] = useState<EnvoiProgres | null>(null);
  const controleur = useRef<AbortController | null>(null);

  const upload = useCallback(
    async (chosen: FileList) => {
      const arret = new AbortController();
      controleur.current = arret;
      setUploading(true);
      onError(null);
      try {
        for (const file of chosen) {
          const issue: IssueEnvoi =
            file.size <= PETIT_FICHIER
              ? await envoiDirect(serverId, path, file, echec, arret.signal)
              : await envoiReprenable(serverId, path, file, setProgres, arret.signal);
          if (issue.statut === "refus") {
            onError(issue.message);
            return;
          }
          if (issue.statut === "annule") break;
        }
        // Relu même après une annulation : les fichiers partis avant elle
        // sont bien arrivés, et doivent apparaître.
        await onDone();
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : echec);
      } finally {
        controleur.current = null;
        setProgres(null);
        setUploading(false);
      }
    },
    [serverId, path, echec, onError, onDone],
  );

  const annuler = useCallback(() => controleur.current?.abort(), []);

  return { upload, annuler, uploading, progres };
}
