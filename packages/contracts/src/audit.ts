import { z } from "zod";

/**
 * Chaîne de filtre facultative.
 *
 * L'écran envoie `?query=` quand le champ est vide : c'est « pas de filtre »,
 * pas « une recherche sur rien ». Ramené à `undefined` ici, une fois pour
 * l'écran et l'export, plutôt qu'à chaque lecteur.
 */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

/**
 * Les filtres du journal de la plateforme.
 *
 * **Un seul schéma pour l'écran et pour l'export**, et c'est tout son intérêt :
 * un export qui n'appliquerait pas exactement ce que l'écran affichait livrerait
 * autre chose que ce que l'administrateur a vérifié avant de cliquer — et ce
 * genre d'écart ne se remarque qu'une fois le fichier transmis.
 *
 * Les identifiants sont validés comme tels : un `actorId` mal formé partait
 * jusqu'à PostgreSQL, qui le refusait en erreur 500.
 */
export const AuditFilters = z.object({
  query: optionalText(200),
  /** Préfixe d'événement : « account. » rassemble tout ce qui touche aux comptes. */
  event: optionalText(120),
  actorId: optionalText(36).pipe(z.string().uuid().optional()),
  serverId: optionalText(36).pipe(z.string().uuid().optional()),
  /** Borne basse, incluse. Une date seule (AAAA-MM-JJ) vaut minuit UTC. */
  since: optionalText(40).pipe(
    z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Date « since » illisible.")
      .optional(),
  ),
});
export type AuditFilters = z.infer<typeof AuditFilters>;

/**
 * Formats d'export.
 *
 * `jsonl` — un objet JSON par ligne — et non un tableau JSON : un tableau ne se
 * referme qu'à la fin, si bien qu'un export interrompu donne un fichier
 * illisible en entier. Une ligne coupée ne coûte, elle, que la dernière ligne.
 */
export const AuditExportFormat = z.enum(["csv", "jsonl"]);
export type AuditExportFormat = z.infer<typeof AuditExportFormat>;

export const AuditExportQuery = AuditFilters.extend({ format: AuditExportFormat.default("csv") });
