import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ApiReference } from "@/components/api-reference";
import { fetchApplicationKeys } from "@/server/api/application-keys";
import { fetchWebhookDeliveries, fetchWebhooks } from "@/server/api/webhooks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apiReference");
  return { title: t("metaTitle") };
}

/**
 * Origine du panel telle que le lecteur l'atteint.
 *
 * Les exemples de la page doivent être copiables tels quels. Une constante
 * écrite en dur enverrait les requêtes d'une installation sur le domaine d'une
 * autre — et sur un panel de test, vers la production. L'en-tête de la requête
 * est la seule source qui dise où ce panel est réellement servi.
 */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function ApiPage() {
  // Tout ce qui concerne l'intégration d'un tiers sur une seule page : ce
  // qu'il peut appeler, la clé qui l'y autorise, et ce que le panel lui
  // renvoie en retour. Les trois se configurent dans la même minute.
  const [origin, keys, webhooks, deliveries] = await Promise.all([
    requestOrigin(),
    fetchApplicationKeys(),
    fetchWebhooks(),
    fetchWebhookDeliveries(),
  ]);

  return <ApiReference origin={origin} keys={keys} webhooks={webhooks} deliveries={deliveries} />;
}
