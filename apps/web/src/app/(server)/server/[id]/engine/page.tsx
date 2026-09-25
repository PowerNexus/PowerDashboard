import { EngineWorkspace } from "@/components/engine-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchBackupRoom, fetchEngineState, fetchEulaState } from "@/server/api/engine";

export const generateMetadata = pageTitle("engine", "metaTitle");

/**
 * Le moteur d'un serveur : sa plateforme, ou son modpack.
 *
 * Les éditeurs sont interrogés **depuis le serveur**, jamais par le navigateur :
 * c'est ce qui permet à l'API de choisir seule l'adresse qu'elle remettra au
 * daemon. Une URL venue du client ferait de celui-ci un téléchargeur de
 * fichiers arbitraires.
 */
export default async function EnginePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const query = search.q ?? "";

  /*
   * Le contrat de licence est lu en même temps que le reste, et son échec ne
   * vide pas la page : un daemon qui ne répond pas sur un fichier ne doit pas
   * empêcher de consulter les moteurs disponibles.
   */
  const [initial, eula, backupRoom] = await Promise.all([
    fetchEngineState(id, query),
    fetchEulaState(id).catch(() => null),
    fetchBackupRoom(id),
  ]);

  return (
    <EngineWorkspace
      serverId={id}
      query={query}
      initial={initial}
      eula={eula}
      canBackup={backupRoom === true}
    />
  );
}
