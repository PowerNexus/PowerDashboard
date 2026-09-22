import { PlatformWebhooks } from "@/components/platform-webhooks";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerKeys } from "@/server/api/reseller-keys";
import {
  createResellerWebhook,
  deleteResellerWebhook,
  fetchResellerWebhookDeliveries,
  fetchResellerWebhooks,
  rotateResellerWebhookSecret,
  setResellerWebhookActive,
} from "@/server/api/reseller-webhooks";

export const generateMetadata = pageTitle("resellerWebhooks", "title");

/**
 * Les rappels sortants du revendeur.
 *
 * Le même écran que l'administration, branché sur les routes qui bornent au
 * périmètre de la session.
 *
 * Les clés proposées sont **les siennes**, et c'est ce qui rend l'écran sûr
 * sans rien lui interdire : un rappel se pose sur une clé, une clé de revendeur
 * ne porte que son trafic, donc il ne peut pas s'abonner à autre chose qu'à
 * lui-même. Le registre le revérifie malgré tout — un écran se contourne, pas
 * une condition dans la requête.
 */
export default async function ResellerWebhooksPage() {
  const [webhooks, deliveries, keys] = await Promise.all([
    fetchResellerWebhooks(),
    fetchResellerWebhookDeliveries(),
    fetchResellerKeys(),
  ]);

  return (
    <PlatformWebhooks
      webhooks={webhooks}
      deliveries={deliveries}
      keys={keys}
      actions={{
        create: createResellerWebhook,
        rotate: rotateResellerWebhookSecret,
        setActive: setResellerWebhookActive,
        remove: deleteResellerWebhook,
      }}
    />
  );
}
