import {
  completeUpload,
  discardUpload,
  openUpload,
  requestUploadGrant,
  type UploadSession,
  uploadStatus,
} from "@/server/api/files";

/**
 * Les deux chemins d'envoi de fichiers, sortis de l'écran qui les déclenche.
 *
 * Ils y vivaient ; l'annulation les a fait grossir au point de noyer l'écran,
 * qui doit rester un assemblage d'organismes et de hooks.
 */

/** Où en est un envoi découpé : un pas par morceau confirmé par le panel. */
export interface EnvoiProgres {
  nom: string;
  fait: number;
  total: number;
}

/** Issue d'un envoi : rien à dire, un refus à montrer, ou une annulation voulue. */
export type IssueEnvoi =
  | { statut: "fait" }
  | { statut: "refus"; message: string }
  | { statut: "annule" };

/**
 * En dessous, l'envoi direct au daemon reste le meilleur chemin.
 *
 * Huit mégaoctets : au-delà, la perte d'un envoi coupé en cours commence à
 * coûter, en dessous elle ne coûte rien et le découpage n'ajouterait que des
 * allers-retours. C'est aussi la taille d'un morceau côté panel, ce qui fait
 * qu'un fichier juste au-dessus du seuil part en deux morceaux et non en un.
 */
export const PETIT_FICHIER = 8 * 1024 * 1024;

/**
 * Le chemin court : le navigateur dépose chez Wings, le panel ne lit rien.
 *
 * Conservé tel quel pour les petits fichiers — un jeton à usage unique, une
 * requête, aucun octet qui transite par le panel.
 */
export async function envoiDirect(
  serverId: string,
  path: string,
  file: File,
  echec: string,
  signal: AbortSignal,
): Promise<IssueEnvoi> {
  const { grant, error } = await requestUploadGrant(serverId);
  if (!grant) return { statut: "refus", message: error ?? echec };
  if (signal.aborted) return { statut: "annule" };

  const body = new FormData();
  // `files` au pluriel : c'est le nom du champ que le daemon lit.
  body.append("files", file);

  const query = `token=${encodeURIComponent(grant.token)}&directory=${encodeURIComponent(path)}`;
  let response: Response;
  try {
    response = await fetch(`${grant.url}?${query}`, { method: "POST", body, signal });
  } catch (cause) {
    if (signal.aborted) return { statut: "annule" };
    throw cause;
  }
  if (response.ok) return { statut: "fait" };

  // Le daemon écrit ses refus en clair — « fichier plus volumineux que la
  // limite de 100 MB », avec le nom du fichier. Les remplacer par un échec
  // générique ferait chercher une panne là où il n'y a qu'un fichier trop gros.
  const corps = (await response.json().catch(() => ({}))) as { error?: string };
  return { statut: "refus", message: corps.error ?? echec };
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
 *
 * **Annuler n'est pas interrompre.** Une coupure laisse la session en place,
 * pour la reprise ; une annulation dit « je n'en veux plus ». Elle arrête le
 * morceau en vol, efface ce que le panel a déjà reçu (`discardUpload`) et
 * oublie la session — sans quoi le prochain envoi du même fichier la
 * reprendrait, et l'annulation n'aurait rien annulé.
 */
export async function envoiReprenable(
  serverId: string,
  path: string,
  file: File,
  onProgres: (etat: EnvoiProgres | null) => void,
  signal: AbortSignal,
): Promise<IssueEnvoi> {
  const cle = `gd-upload:${serverId}:${path}:${file.name}:${file.size}`;
  let session = await reprendre(serverId, cle);

  if (!session) {
    const { session: ouverte, error } = await openUpload(serverId, {
      directory: path,
      fileName: file.name,
      size: file.size,
    });
    if (!ouverte) return { statut: "refus", message: error ?? "Envoi refusé." };
    session = ouverte;
    try {
      localStorage.setItem(cle, ouverte.id);
    } catch {
      // Navigation privée, stockage plein : l'envoi marche quand même, il ne
      // survivra simplement pas à un rechargement.
    }
  }

  const abandonner = async (id: string): Promise<IssueEnvoi> => {
    oublier(cle);
    await discardUpload(serverId, id);
    return { statut: "annule" };
  };

  const recus = new Set(session.received);
  onProgres({ nom: file.name, fait: recus.size, total: session.chunks });

  for (let index = 0; index < session.chunks; index++) {
    if (recus.has(index)) continue;
    // Vérifié avant chaque morceau, et pas seulement pendant : une annulation
    // tombée entre deux morceaux n'a aucune requête à interrompre.
    if (signal.aborted) return abandonner(session.id);

    const debut = index * session.chunkSize;
    const morceau = file.slice(debut, Math.min(debut + session.chunkSize, file.size));
    let reponse: Response;
    try {
      reponse = await fetch(`/api/upload-chunk/${serverId}/${session.id}/${index}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: morceau,
        signal,
      });
    } catch (cause) {
      if (signal.aborted) return abandonner(session.id);
      throw cause;
    }

    if (!reponse.ok) {
      const corps = (await reponse.json().catch(() => ({}))) as { message?: string };
      // La session reste notée : l'envoi se reprendra là où il s'est arrêté.
      return { statut: "refus", message: corps.message ?? `Morceau ${index + 1} refusé.` };
    }
    recus.add(index);
    onProgres({ nom: file.name, fait: recus.size, total: session.chunks });
  }

  // Dernière chance d'annuler : une fois l'assemblage demandé, le fichier est
  // en cours d'écriture chez le daemon et il n'y a plus rien à retirer.
  if (signal.aborted) return abandonner(session.id);

  const { error } = await completeUpload(serverId, session.id);
  oublier(cle);
  return error ? { statut: "refus", message: error } : { statut: "fait" };
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
