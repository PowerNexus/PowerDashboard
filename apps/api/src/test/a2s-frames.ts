/**
 * Trames A2S d'essai, écrites comme un serveur Source les envoie. Partagées
 * par les tests du codec, de la socket et de la sonde.
 */

import { createSocket } from "node:dgram";

export const entete = (type: number) => Buffer.from([0xff, 0xff, 0xff, 0xff, type]);
export const chaine = (valeur: string) =>
  Buffer.concat([Buffer.from(valeur, "utf8"), Buffer.from([0])]);
const court = (valeur: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(valeur);
  return b;
};

export function trameInfo(options: {
  nom?: string;
  carte?: string;
  joueurs?: number;
  max?: number;
  version?: string | null;
  appId?: number;
}): Buffer {
  return Buffer.concat([
    entete(0x49),
    Buffer.from([17]),
    chaine(options.nom ?? "Rust FR #1"),
    chaine(options.carte ?? "Procedural Map"),
    chaine("rust"),
    chaine("Rust"),
    // Seize bits : un identifiant plus grand est tronqué, le vrai va dans l'EDF.
    court((options.appId ?? 252_490) & 0xffff),
    Buffer.from([options.joueurs ?? 3, options.max ?? 100, 0, 0x64, 0x6c, 0, 1]),
    ...(options.appId === 2400 ? [Buffer.from([0, 0, 0])] : []),
    ...(options.version === null ? [] : [chaine(options.version ?? "2590")]),
  ]);
}

export function trameJoueurs(noms: string[]): Buffer {
  return Buffer.concat([
    entete(0x44),
    Buffer.from([noms.length]),
    ...noms.map((nom, index) =>
      Buffer.concat([Buffer.from([index]), chaine(nom), Buffer.alloc(8)]),
    ),
  ]);
}

export function trameDefi(defi: number[]): Buffer {
  return Buffer.concat([entete(0x41), Buffer.from(defi)]);
}

/**
 * Faux serveur A2S, en UDP sur la boucle locale.
 *
 * Il exige un défi pour l'information comme pour la liste des joueurs, comme
 * les serveurs Source depuis fin 2020 : un client qui ne le renvoie pas
 * n'obtient rien.
 */
export async function serveurA2s(options: {
  info?: Buffer;
  /** `"split"` : liste envoyée en plusieurs datagrammes ; `"muet"` : jamais envoyée. */
  joueurs?: string[] | "split" | "muet";
}): Promise<{ port: number; demandes: Buffer[]; fermer: () => Promise<void> }> {
  const socket = createSocket("udp4");
  const demandes: Buffer[] = [];
  const defi = Buffer.from([0x12, 0x34, 0x56, 0x78]);

  socket.on("message", (demande, rinfo) => {
    demandes.push(demande);
    const repondre = (trame: Buffer) => socket.send(trame, rinfo.port, rinfo.address);
    const type = demande[4];
    const recu = demande.subarray(-4);

    if (type === 0x54) {
      if (demande.length === 25) return repondre(trameDefi([...defi]));
      if (recu.equals(defi)) repondre(options.info ?? trameInfo({}));
    } else if (type === 0x55) {
      if (!recu.equals(defi)) return repondre(trameDefi([...defi]));
      const joueurs = options.joueurs ?? [];
      if (joueurs === "muet") return;
      if (joueurs === "split")
        return repondre(Buffer.from([0xfe, 0xff, 0xff, 0xff, 1, 0, 0, 0, 2, 0]));
      repondre(trameJoueurs(joueurs));
    }
  });

  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  return {
    port: socket.address().port,
    demandes,
    fermer: () => new Promise((resolve) => socket.close(() => resolve())),
  };
}
