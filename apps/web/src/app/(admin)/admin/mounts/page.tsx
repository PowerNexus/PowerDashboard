import { MountsWorkspace } from "@/components/mounts-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchMounts } from "@/server/api/mounts";

export const generateMetadata = pageTitle("mounts", "metaTitle");

export default async function MountsPage() {
  return <MountsWorkspace mounts={await fetchMounts()} />;
}
