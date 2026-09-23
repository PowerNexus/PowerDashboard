import { AdminEggEditor } from "@/components/admin-egg-editor";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminEgg } from "@/server/api/admin";

export const generateMetadata = pageTitle("adminEggEditor", "metaTitle");

/**
 * Éditeur d'un egg.
 *
 * `key` sur l'egg et ses variables : quand un enregistrement ajoute ou retire
 * une variable, l'éditeur repart de ce que l'API a gardé. Sans cela, une
 * variable ajoutée resterait sans identifiant dans le brouillon, et le
 * prochain enregistrement tenterait de la créer une seconde fois.
 */
export default async function AdminEggEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const egg = await fetchAdminEgg(id);
  return <AdminEggEditor key={`${egg.id}-${egg.variables.map((v) => v.id).join(",")}`} egg={egg} />;
}
