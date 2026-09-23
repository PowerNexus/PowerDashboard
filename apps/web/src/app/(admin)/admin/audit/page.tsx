import { AuditWorkspace } from "@/components/audit-workspace";
import { pageTitle } from "@/lib/page-title";
import { CONFIGURATION_ROLES } from "@/lib/roles";
import { AUDIT_FILTER_KEYS, fetchAudit } from "@/server/api/audit";
import { fetchMe } from "@/server/api/client";

export const generateMetadata = pageTitle("audit", "metaTitle");

/**
 * Journal de la plateforme.
 *
 * Les filtres sont lus dans l'adresse et non dans un état de composant : une
 * recherche qui a trouvé quelque chose doit pouvoir se transmettre par copier-
 * coller, ce qui compte quand on répond à une question posée par écrit.
 *
 * **Tous** les filtres de l'adresse partent à l'API, même ceux que la barre ne
 * propose pas (`actorId`, `serverId`, `since`) : l'export les reprend, et la
 * liste doit montrer exactement ce que le fichier contiendra.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parameters = await searchParams;
  const text = (key: string): string =>
    typeof parameters[key] === "string" ? (parameters[key] as string) : "";

  const filters = Object.fromEntries(AUDIT_FILTER_KEYS.map((key) => [key, text(key)]));
  const [page, me] = await Promise.all([
    fetchAudit({ ...filters, page: Number(text("page")) || 1 }),
    fetchMe(),
  ]);

  return (
    <AuditWorkspace
      page={page}
      query={text("query")}
      event={text("event")}
      canExport={CONFIGURATION_ROLES.has(me.role)}
    />
  );
}
