import { notFound } from "next/navigation";
import { ConsoleWorkspace } from "@/components/console-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchConsoleCommands, fetchMyServer } from "@/server/api/client";

export const generateMetadata = pageTitle("console", "title");

export default async function ServerConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [server, commands] = await Promise.all([fetchMyServer(id), fetchConsoleCommands(id)]);
  if (!server) notFound();

  return <ConsoleWorkspace server={server} commands={commands} />;
}
