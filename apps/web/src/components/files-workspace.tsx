"use client";

import {
  AlertBanner,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  FileBrowser,
  type FileEntry,
  Input,
  PageHeader,
  PageTemplate,
  RowActions,
  Skeleton,
} from "@gamedashboard/ui";
import {
  Download,
  FileArchive,
  FilePlus2,
  Files,
  FolderArchive,
  FolderInput,
  FolderPlus,
  KeyRound,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFileUpload } from "@/lib/use-file-upload";
import {
  compressFiles,
  createDirectory,
  decompressFile,
  deleteFiles,
  listFiles,
  requestDownloadUrl,
  writeFile,
} from "@/server/api/files";
import { FilesPermissionsDialog } from "./files-permissions-dialog";
import { FilesRenameDialog } from "./files-rename-dialog";
import { FilesUploadProgress } from "./files-upload-progress";
import { ServerBlockBanner, useServerBlock } from "./server-block-context";

/**
 * Gestionnaire de fichiers, branché sur le daemon.
 *
 * La navigation recharge à chaque dossier plutôt que de tout garder en
 * mémoire : un serveur de jeu peut contenir des dizaines de milliers de
 * fichiers, et un client qui ouvre le dossier des mondes n'a aucune raison
 * d'attendre le chargement de tout le volume.
 */
export function FilesWorkspace({ serverId }: { serverId: string }) {
  const t = useTranslations("files");
  const tc = useTranslations("common");
  const tf = useTranslations("fileTools");
  const router = useRouter();
  const [path, setPath] = useState("/");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<FileEntry | null>(null);
  const [toRename, setToRename] = useState<FileEntry | null>(null);
  const [toChmod, setToChmod] = useState<FileEntry | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();
  /*
   * Ici, presque tout écrit.
   *
   * Pendant une installation, le daemon peuple l'arborescence : y ajouter un
   * fichier, en retirer un ou compresser un dossier donnerait un résultat que
   * personne ne saurait décrire. Sur un serveur suspendu, c'est le disque de
   * l'hébergeur qu'on remplirait après la coupure.
   *
   * Lire reste ouvert — parcourir, télécharger, ouvrir un fichier. Couper la
   * lecture enfermerait quelqu'un loin de ses propres données au moment
   * précis où il en a besoin pour comprendre ce qui lui arrive.
   */
  const bloc = useServerBlock();
  const fige = bloc !== null;
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (directory: string) => {
      setEntries(null);
      setError(null);
      try {
        setEntries(await listFiles(serverId, directory));
      } catch (cause) {
        // Le node peut être injoignable : le dire, plutôt que d'afficher un
        // dossier vide qui laisserait croire que le serveur a perdu ses données.
        setError(cause instanceof Error ? cause.message : t("unreadable"));
        setEntries([]);
      }
    },
    [serverId, t],
  );

  useEffect(() => {
    void load(path);
  }, [path, load]);

  const openEditor = (fileName: string) => {
    const full = `${path === "/" ? "" : path}/${fileName}`;
    router.push(`/server/${serverId}/files/edit?path=${encodeURIComponent(full)}`);
  };

  const visible = useMemo(() => {
    if (!entries) return [];
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, query]);

  const reload = useCallback(() => load(path), [load, path]);
  const { upload, annuler, uploading, progres } = useFileUpload({
    serverId,
    path,
    echec: t("uploadFailed"),
    onError: setError,
    onDone: reload,
  });

  /**
   * Fait tirer un fichier par le navigateur, directement au daemon.
   *
   * Ni `fetch` ni lecture côté panel : on ouvre l'adresse, et le navigateur
   * fait ce qu'il sait faire — il enregistre, avec sa barre de progression et
   * sa reprise sur coupure. La passer par le panel nous obligerait à tout
   * réécrire, en moins bien.
   *
   * L'adresse ne vaut qu'une minute et qu'une fois : elle est demandée au
   * moment du clic, jamais posée à l'avance dans un `href` que la page
   * porterait pour tous ses fichiers.
   */
  const download = useCallback(
    async (fileName: string) => {
      const full = `${path === "/" ? "" : path}/${fileName}`;
      const { url, error: refus } = await requestDownloadUrl(serverId, full);
      if (!url) {
        setError(refus ?? t("downloadFailed"));
        return;
      }
      // `location.assign` plutôt qu'un onglet : le daemon répond avec un
      // en-tête de pièce jointe, donc rien ne s'affiche — un onglet s'ouvrirait
      // et se refermerait aussitôt, ce qui se lit comme un échec.
      window.location.assign(url);
    },
    [serverId, path, t],
  );

  const run = (action: () => Promise<{ error: string | null }>) =>
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else await load(path);
    });

  return (
    <PageTemplate
      notice={<ServerBlockBanner />}
      header={
        <PageHeader
          icon={<Files />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => setNewFolder(true)}
                disabled={pending || fige}
              >
                <FolderPlus /> {t("newFolder")}
              </Button>
              <Button
                variant="secondary"
                disabled={pending || fige}
                onClick={() =>
                  run(async () => {
                    const name = `nouveau-fichier-${Date.now()}.txt`;
                    const result = await writeFile(
                      serverId,
                      `${path === "/" ? "" : path}/${name}`,
                      "",
                    );
                    return result;
                  })
                }
              >
                <FilePlus2 /> {t("newFile")}
              </Button>
              <Button
                disabled={pending || uploading || fige}
                onClick={() => fileInput.current?.click()}
              >
                <Upload /> {uploading ? t("uploading") : t("upload")}
              </Button>
              {/*
                Le champ natif reste caché : son rendu par défaut ne se met pas
                à la forme des autres boutons, et le remplacer par un bouton
                qui le déclenche donne la même fenêtre de sélection.
              */}
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files;
                  if (chosen && chosen.length > 0) void upload(chosen);
                  // Remis à zéro : sans cela, renvoyer deux fois le même
                  // fichier ne déclencherait pas de second changement.
                  event.target.value = "";
                }}
              />
            </>
          }
        />
      }
      toolbar={
        <Input
          className="sm:max-w-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filter")}
          leadingIcon={<Search />}
        />
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {progres ? <FilesUploadProgress progres={progres} onCancel={annuler} /> : null}

      {entries === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : visible.length === 0 && !query ? (
        <EmptyState icon={<Files />} title={t("emptyFolder")} description={t("emptyFolderHint")} />
      ) : (
        <FileBrowser
          path={path}
          entries={visible}
          onNavigate={(p) => {
            setQuery("");
            setPath(p);
          }}
          onOpenFile={(entry) => openEditor(entry.name)}
          rowActions={(entry) => (
            <RowActions>
              {!entry.isDirectory ? (
                <DropdownItem icon={<Pencil />} onSelect={() => openEditor(entry.name)}>
                  {tc("edit")}
                </DropdownItem>
              ) : null}
              <DropdownItem
                icon={<FolderInput />}
                disabled={fige}
                onSelect={() => setToRename(entry)}
              >
                {tf("rename")}
              </DropdownItem>
              <DropdownItem icon={<KeyRound />} disabled={fige} onSelect={() => setToChmod(entry)}>
                {tf("permissions")}
              </DropdownItem>
              <DropdownSeparator />
              {/* Un dossier ne se tire pas tel quel : on le compresse d'abord. */}
              {!entry.isDirectory ? (
                <DropdownItem icon={<Download />} onSelect={() => void download(entry.name)}>
                  {t("download")}
                </DropdownItem>
              ) : null}
              {/*
                Compresser vaut pour un fichier comme pour un dossier : c'est
                le daemon qui empaquette, et il ne fait pas la différence.
              */}
              <DropdownItem
                icon={<FolderArchive />}
                disabled={fige}
                onSelect={() => run(() => compressFiles(serverId, path, [entry.name]))}
              >
                {t("compress")}
              </DropdownItem>
              {/*
                « Extraire » n'apparaît que sur ce qui en a l'air. Le proposer
                partout ferait cliquer pour rien sur un `server.properties` —
                et le daemon refuserait, poliment mais inutilement.
              */}
              {isArchive(entry.name) ? (
                <DropdownItem
                  icon={<FileArchive />}
                  disabled={fige}
                  onSelect={() => run(() => decompressFile(serverId, path, entry.name))}
                >
                  {t("decompress")}
                </DropdownItem>
              ) : null}
              <DropdownItem
                icon={<Trash2 />}
                destructive
                disabled={fige}
                onSelect={() => setToDelete(entry)}
              >
                {tc("delete")}
              </DropdownItem>
            </RowActions>
          )}
        />
      )}

      <Dialog open={newFolder} onOpenChange={setNewFolder}>
        <DialogContent
          title={t("newFolder")}
          description={t("createdIn", { path })}
          footer={
            <Button
              disabled={newName.trim() === "" || pending}
              onClick={() => {
                run(() => createDirectory(serverId, path, newName.trim()));
                setNewFolder(false);
                setNewName("");
              }}
            >
              {tc("create")}
            </Button>
          }
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("folderName")}
            autoFocus
          />
        </DialogContent>
      </Dialog>

      <FilesRenameDialog
        serverId={serverId}
        path={path}
        entry={toRename}
        onClose={() => setToRename(null)}
        onRenamed={reload}
      />
      <FilesPermissionsDialog
        serverId={serverId}
        path={path}
        entry={toChmod}
        onClose={() => setToChmod(null)}
        onChanged={reload}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("deleteTitle")}
        description={toDelete ? t("deleteBody", { name: toDelete.name }) : undefined}
        confirmLabel={tc("delete")}
        destructive
        // Le nom doit être retapé : une suppression de dossier sur un serveur de
        // jeu emporte des mondes entiers, et il n'existe aucune corbeille.
        requireTyped={toDelete?.name}
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target) run(() => deleteFiles(serverId, path, [target.name]));
        }}
      />
    </PageTemplate>
  );
}

/**
 * Extensions d'archives que Wings sait ouvrir.
 *
 * Reconnues sur le **nom**, pas sur le type MIME : le listage du daemon rend
 * souvent `application/octet-stream` pour une archive, et se fier à cela
 * ferait disparaître « Extraire » précisément là où il sert.
 *
 * La liste n'est pas une garantie — c'est le daemon qui tranche, et il refuse
 * proprement ce qu'il ne comprend pas. Elle ne décide que de l'affichage d'une
 * entrée de menu, et un doute se paie donc au pire d'un refus lisible.
 */
const ARCHIVE_SUFFIXES = [
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
  ".tar.zst",
  ".tar",
  ".tgz",
  ".zip",
  ".rar",
  ".7z",
  ".gz",
];

function isArchive(name: string): boolean {
  const lower = name.toLowerCase();
  return ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}
