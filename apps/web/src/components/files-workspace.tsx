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
  Progress,
  RowActions,
  Skeleton,
} from "@gamedashboard/ui";
import {
  Download,
  FileArchive,
  FilePlus2,
  Files,
  FolderArchive,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  completeUpload,
  compressFiles,
  createDirectory,
  decompressFile,
  deleteFiles,
  listFiles,
  openUpload,
  requestDownloadUrl,
  requestUploadGrant,
  type UploadSession,
  uploadStatus,
  writeFile,
} from "@/server/api/files";
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
  const router = useRouter();
  const [path, setPath] = useState("/");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<FileEntry | null>(null);
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
  const [uploading, setUploading] = useState(false);
  /** Où en est l'envoi en cours, quand il est assez gros pour être découpé. */
  const [progres, setProgres] = useState<{ nom: string; fait: number; total: number } | null>(null);
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

  /**
   * Envoie les fichiers choisis, par l'un de deux chemins.
   *
   * **Petit fichier : droit au daemon.** Le panel ne voit passer que
   * l'autorisation — une adresse et un jeton à usage unique — et le navigateur
   * dépose chez Wings. C'est le trajet le plus court, et il n'a aucune raison
   * de changer pour un fichier de configuration.
   *
   * **Gros fichier : découpé, et repris s'il le faut.** Là, le chemin court
   * n'est plus acceptable : une coupure au bout de deux gigaoctets renverrait
   * au premier octet. Les morceaux vont au panel, qui les garde et les recolle
   * — le daemon ne sachant pas compléter un fichier déjà commencé.
   *
   * Le dossier courant part en paramètre dans les deux cas : c'est là qu'on se
   * trouve, et c'est là que le fichier doit atterrir.
   */
  const upload = useCallback(
    async (chosen: FileList) => {
      setUploading(true);
      setError(null);
      try {
        for (const file of chosen) {
          if (file.size <= PETIT_FICHIER) {
            const refus = await envoiDirect(serverId, path, file, t("uploadFailed"));
            if (refus) {
              setError(refus);
              return;
            }
          } else {
            const refus = await envoiReprenable(serverId, path, file, setProgres);
            if (refus) {
              setError(refus);
              return;
            }
          }
        }
        await load(path);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("uploadFailed"));
      } finally {
        setProgres(null);
        setUploading(false);
      }
    },
    [serverId, path, load, t],
  );

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

      {/*
       * La progression n'apparaît que pour les envois découpés.
       *
       * Un petit fichier part en une requête : y accrocher une barre la ferait
       * clignoter sans rien apprendre. Ici elle dit quelque chose de vrai —
       * chaque pas est un morceau que le panel a confirmé avoir reçu, et un
       * envoi repris repart de ce compte-là.
       */}
      {progres ? (
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate font-medium text-fg text-sm">{progres.nom}</span>
            <span className="shrink-0 text-muted text-xs tabular-nums">
              {t("uploadProgress", { done: progres.fait, total: progres.total })}
            </span>
          </div>
          <Progress value={progres.fait} max={progres.total} label={t("uploading")} />
        </div>
      ) : null}

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

/**
 * En dessous, l'envoi direct au daemon reste le meilleur chemin.
 *
 * Huit mégaoctets : au-delà, la perte d'un envoi coupé en cours commence à
 * coûter, en dessous elle ne coûte rien et le découpage n'ajouterait que des
 * allers-retours. C'est aussi la taille d'un morceau côté panel, ce qui fait
 * qu'un fichier juste au-dessus du seuil part en deux morceaux et non en un.
 */
const PETIT_FICHIER = 8 * 1024 * 1024;

/**
 * Le chemin court : le navigateur dépose chez Wings, le panel ne lit rien.
 *
 * Conservé tel quel pour les petits fichiers — un jeton à usage unique, une
 * requête, aucun octet qui transite par le panel.
 */
async function envoiDirect(
  serverId: string,
  path: string,
  file: File,
  echec: string,
): Promise<string | null> {
  const { grant, error } = await requestUploadGrant(serverId);
  if (!grant) return error ?? echec;

  const body = new FormData();
  // `files` au pluriel : c'est le nom du champ que le daemon lit.
  body.append("files", file);

  const query = `token=${encodeURIComponent(grant.token)}&directory=${encodeURIComponent(path)}`;
  const response = await fetch(`${grant.url}?${query}`, { method: "POST", body });
  if (response.ok) return null;

  // Le daemon écrit ses refus en clair — « fichier plus volumineux que la
  // limite de 100 MB », avec le nom du fichier. Les remplacer par un échec
  // générique ferait chercher une panne là où il n'y a qu'un fichier trop gros.
  const corps = (await response.json().catch(() => ({}))) as { error?: string };
  return corps.error ?? echec;
}

/**
 * Le chemin long : découpé, repris, et assemblé par le panel.
 *
 * **Ce qui rend la reprise possible** est que le panel garde les morceaux : le
 * daemon, lui, ne sait pas compléter un fichier déjà commencé — son écriture
 * prend un corps entier et sa longueur. C'est donc le panel qui recolle, et
 * c'est lui qu'on interroge pour savoir où l'on en était.
 *
 * La session est notée dans le stockage local pour survivre à un
 * rechargement : sans cela, une reprise ne serait possible qu'au sein de la
 * même page, c'est-à-dire pas dans le cas qui compte.
 */
async function envoiReprenable(
  serverId: string,
  path: string,
  file: File,
  onProgres: (etat: { nom: string; fait: number; total: number } | null) => void,
): Promise<string | null> {
  const cle = `gd-upload:${serverId}:${path}:${file.name}:${file.size}`;
  let session = await reprendre(serverId, cle);

  if (!session) {
    const { session: ouverte, error } = await openUpload(serverId, {
      directory: path,
      fileName: file.name,
      size: file.size,
    });
    if (!ouverte) return error;
    session = ouverte;
    try {
      localStorage.setItem(cle, ouverte.id);
    } catch {
      // Navigation privée, stockage plein : l'envoi marche quand même, il ne
      // survivra simplement pas à un rechargement.
    }
  }

  const reste = new Set(session.received);
  onProgres({ nom: file.name, fait: reste.size, total: session.chunks });

  for (let index = 0; index < session.chunks; index++) {
    if (reste.has(index)) continue;

    const debut = index * session.chunkSize;
    const morceau = file.slice(debut, Math.min(debut + session.chunkSize, file.size));
    const reponse = await fetch(`/api/upload-chunk/${serverId}/${session.id}/${index}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: morceau,
    });

    if (!reponse.ok) {
      const corps = (await reponse.json().catch(() => ({}))) as { message?: string };
      // La session reste notée : l'envoi se reprendra là où il s'est arrêté.
      return corps.message ?? `Morceau ${index + 1} refusé.`;
    }
    reste.add(index);
    onProgres({ nom: file.name, fait: reste.size, total: session.chunks });
  }

  const { error } = await completeUpload(serverId, session.id);
  oublier(cle);
  return error;
}

/** La session laissée par un envoi interrompu, si le panel la connaît encore. */
async function reprendre(serverId: string, cle: string): Promise<UploadSession | null> {
  let connu: string | null = null;
  try {
    connu = localStorage.getItem(cle);
  } catch {
    return null;
  }
  if (!connu) return null;

  const { session } = await uploadStatus(serverId, connu);
  // Une session effacée par le balayage des six heures n'est pas une erreur :
  // on repart simplement du début.
  if (!session) oublier(cle);
  return session;
}

function oublier(cle: string): void {
  try {
    localStorage.removeItem(cle);
  } catch {
    // Rien à faire : la clé disparaîtra avec le stockage.
  }
}
