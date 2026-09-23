import type { AuditExportFormat } from "@gamedashboard/contracts";
import type { PlatformActivityEntry } from "./activity.service";

/**
 * Mise en forme de l'export du journal de la plateforme (PLAN §5.4).
 *
 * Fonctions pures, à part du service : ce qui compte ici — l'échappement, la
 * neutralisation des formules — se vérifie sans base, et doit l'être.
 */

/**
 * Les colonnes du CSV, dans l'ordre.
 *
 * Les propriétés partent en JSON dans une seule colonne : leur forme change
 * d'un événement à l'autre, et les étaler en colonnes donnerait un fichier
 * dont l'en-tête dépendrait des lignes exportées.
 */
export const AUDIT_CSV_COLUMNS = [
  "id",
  "at",
  "event",
  "actorType",
  "actorId",
  "actorLabel",
  "ip",
  "serverId",
  "serverName",
  "properties",
] as const satisfies readonly (keyof PlatformActivityEntry)[];

/**
 * Premiers caractères qu'un tableur interprète comme le début d'une formule.
 *
 * `=`, `+`, `-` et `@` ouvrent une formule dans Excel, LibreOffice et Google
 * Sheets ; la tabulation et le retour chariot en tête sont les variantes
 * classiques pour contourner un filtre qui ne regarde que les quatre premiers
 * (recommandation OWASP « CSV Injection »).
 */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Une cellule CSV sûre.
 *
 * **Deux défenses, pour deux dangers distincts.**
 *
 * 1. La neutralisation des formules. Le journal recopie ce que les gens
 *    écrivent — un nom d'utilisateur, un nom de serveur, une commande de
 *    console. Un client qui s'appelle `=HYPERLINK("http://…";"cliquez")`
 *    deviendrait, dans le tableur de l'administrateur, un lien piégé ou une
 *    formule qui exfiltre les cellules voisines. Une apostrophe en tête force
 *    le tableur à lire du texte ; elle reste visible, et c'est le prix honnête
 *    — on voit que la valeur a été désamorcée.
 * 2. L'échappement RFC 4180. Toute cellule est entourée de guillemets et ses
 *    guillemets sont doublés : une virgule, un saut de ligne ou un guillemet
 *    dans une valeur ne peut plus fabriquer une colonne ou une ligne de plus.
 *
 * Tout est mis entre guillemets, sans exception : décider au cas par cas est
 * exactement l'endroit où une règle oublie un caractère.
 */
export function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (typeof value === "string") text = value;
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);

  if (text !== "" && FORMULA_TRIGGERS.has(text[0] as string)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Fin de ligne CRLF : celle de la RFC 4180, et celle qu'Excel attend. */
const CRLF = "\r\n";

export function csvLine(values: readonly unknown[]): string {
  return values.map(csvCell).join(",") + CRLF;
}

export function csvRow(entry: PlatformActivityEntry): string {
  return csvLine(AUDIT_CSV_COLUMNS.map((column) => entry[column]));
}

/**
 * Une ligne JSON.
 *
 * Aucune neutralisation ici : un fichier JSON ne s'ouvre pas dans un tableur
 * qui exécuterait son contenu, et altérer les valeurs trahirait le journal
 * pour les scripts qui le relisent.
 */
export function jsonLine(entry: PlatformActivityEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export interface AuditExportFile {
  filename: string;
  contentType: string;
  /** Le contenu, morceau par morceau : jamais le fichier entier en mémoire. */
  chunks: AsyncIterable<string>;
}

/**
 * Le fichier, prêt à être transmis.
 *
 * Le CSV commence par une marque d'ordre des octets : sans elle, Excel lit
 * l'UTF-8 comme du Windows-1252 et tous les accents du journal — « Arrêt »,
 * « Réinstallation » — arrivent en bouillie. Le JSON n'en a pas besoin, et un
 * script qui le relit ligne à ligne la trouverait collée au premier objet.
 */
export function auditExportFile(
  format: AuditExportFormat,
  entries: AsyncIterable<PlatformActivityEntry>,
  now: Date = new Date(),
): AuditExportFile {
  // Horodatage dans le nom : deux exports du même jour ne s'écrasent pas
  // l'un l'autre dans le dossier de téléchargement.
  const stamp = now.toISOString().slice(0, 19).replaceAll(":", "-");

  if (format === "jsonl") {
    return {
      filename: `journal-${stamp}.jsonl`,
      contentType: "application/x-ndjson; charset=utf-8",
      chunks: (async function* () {
        for await (const entry of entries) yield jsonLine(entry);
      })(),
    };
  }

  return {
    filename: `journal-${stamp}.csv`,
    contentType: "text/csv; charset=utf-8",
    chunks: (async function* () {
      yield `\uFEFF${csvLine(AUDIT_CSV_COLUMNS)}`;
      for await (const entry of entries) yield csvRow(entry);
    })(),
  };
}
