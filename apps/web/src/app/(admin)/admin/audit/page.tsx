import { AuditWorkspace } from "@/components/audit-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchAudit } from "@/server/api/audit";

export const generateMetadata = pageTitle("audit", "metaTitle");

/**
 * Journal de la plateforme.
 *
 * Les filtres sont lus dans l'adresse et non dans un état de composant : une
 * recherche qui a trouvé quelque chose doit pouvoir se transmettre par copier-
 * coller, ce qui compte quand on répond à une question posée par écrit.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parameters = await searchParams;
  const text = (key: string): string =>
    typeof parameters[key] === "string" ? (parameters[key] as string) : "";

  const page = await fetchAudit({
    query: text("query"),
    event: text("event"),
    page: Number(text("page")) || 1,
  });

  return <AuditWorkspace page={page} query={text("query")} event={text("event")} />;
}
