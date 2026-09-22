import { SchedulesWorkspace } from "@/components/schedules-workspace";
import { pageTitle } from "@/lib/page-title";
import { listSchedules } from "@/server/api/schedules";

export const generateMetadata = pageTitle("schedules", "title");

export default async function SchedulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SchedulesWorkspace serverId={id} initial={await listSchedules(id)} />;
}
