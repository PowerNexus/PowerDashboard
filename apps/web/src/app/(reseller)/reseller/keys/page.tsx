import { ApplicationKeys } from "@/components/application-keys";
import { pageTitle } from "@/lib/page-title";
import {
  createResellerKey,
  fetchResellerKeys,
  resellerScopeCatalogue,
  revokeResellerKey,
} from "@/server/api/reseller-keys";

export const generateMetadata = pageTitle("resellerKeys", "title");

/**
 * Les clés applicatives du revendeur.
 *
 * Le même écran que l'administration, branché sur d'autres routes : celles qui
 * bornent tout au périmètre de la session. Un second composant aurait garanti
 * qu'une correction faite d'un côté manque de l'autre.
 *
 * Le catalogue des portées est réduit : les portées de la plateforme ne sont
 * pas proposées, parce que l'API les refuserait à l'émission.
 */
export default async function ResellerKeysPage() {
  const [keys, catalogue] = await Promise.all([fetchResellerKeys(), resellerScopeCatalogue()]);

  return (
    <ApplicationKeys
      keys={keys}
      catalogue={catalogue}
      actions={{ create: createResellerKey, revoke: revokeResellerKey }}
    />
  );
}
