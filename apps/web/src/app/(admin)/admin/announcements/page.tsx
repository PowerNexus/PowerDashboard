import { AnnouncementsWorkspace } from "@/components/announcements-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchAnnouncements } from "@/server/api/announcements";

export const generateMetadata = pageTitle("announcements", "metaTitle");

export default async function AnnouncementsPage() {
  return <AnnouncementsWorkspace announcements={await fetchAnnouncements()} />;
}
