import { notFound } from "next/navigation";
import { FileEditorWorkspace } from "@/components/file-editor-workspace";
import { pageTitle } from "@/lib/page-title";
import { readFile } from "@/server/api/files";

export const generateMetadata = pageTitle("fileEditor", "title");

export default async function FileEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const [{ id }, { path }] = await Promise.all([params, searchParams]);

  // Sans chemin, il n'y a rien à éditer : un défaut arbitraire ouvrirait un
  // fichier que l'utilisateur n'a pas demandé, et qu'il pourrait écraser.
  if (!path) notFound();

  const content = await readFile(id, path);
  return <FileEditorWorkspace serverId={id} path={path} initialContent={content} />;
}
