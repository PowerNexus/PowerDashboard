import { announcements, type Database } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, arrayContains, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Annonces de la plateforme.
 *
 * **Distinctes des incidents, et ce n'est pas une nuance.** Un incident est
 * subi : il se déclare, se suit, et vit sur la page d'état, publique. Une
 * annonce est décidée — « maintenance samedi de 2 h à 4 h », « nouvelle
 * région disponible » — elle s'adresse à des gens connectés, et elle a une
 * fenêtre de diffusion. Les confondre ferait apparaître une maintenance
 * planifiée comme une panne en cours.
 *
 * Distinctes aussi des notifications : celles-ci s'adressent à **une**
 * personne à propos de **son** serveur, et restent dans sa cloche. Une annonce
 * s'adresse à tout le monde, ou à un rôle, et disparaît d'elle-même.
 */

/** Ce qu'un écran affiche. Le corps est du Markdown restreint, rendu par le client. */
export interface Announcement {
  id: string;
  title: string;
  bodyMd: string;
  level: "info" | "warning" | "critical";
  startsAt: string;
  endsAt: string | null;
  /** Rôles visés. Vide = tout le monde, ce qui est le cas courant. */
  audience: string[];
}

const LEVELS = new Set(["info", "warning", "critical"]);

/** Rôles auxquels une annonce peut s'adresser. */
const ROLES = new Set(["user", "reseller", "support", "admin"]);

@Injectable()
export class AnnouncementsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Toutes les annonces, passées comprises : l'administration les gère. */
  async list(): Promise<Announcement[]> {
    return this.db
      .select({
        id: announcements.id,
        title: announcements.title,
        bodyMd: announcements.bodyMd,
        level: announcements.level,
        startsAt: announcements.startsAt,
        endsAt: announcements.endsAt,
        audience: announcements.audience,
      })
      .from(announcements)
      .orderBy(desc(announcements.startsAt));
  }

  /**
   * Annonces en cours pour un rôle donné.
   *
   * La fenêtre est appliquée **par la requête** et non après coup : filtrer en
   * mémoire ferait descendre tout l'historique à chaque chargement de page, et
   * un filtre écrit deux fois finit par l'être de deux façons.
   *
   * `ends_at` nul veut dire « sans fin annoncée », pas « terminée » : c'est le
   * cas d'une information permanente, et la traiter comme une échéance passée
   * la ferait disparaître aussitôt publiée.
   */
  async active(role: string): Promise<Announcement[]> {
    return this.db
      .select({
        id: announcements.id,
        title: announcements.title,
        bodyMd: announcements.bodyMd,
        level: announcements.level,
        startsAt: announcements.startsAt,
        endsAt: announcements.endsAt,
        audience: announcements.audience,
      })
      .from(announcements)
      .where(
        and(
          lte(announcements.startsAt, sql`now()`),
          or(isNull(announcements.endsAt), gt(announcements.endsAt, sql`now()`)),
          // Public vide = tout le monde. Le cas est traité en SQL avec le
          // ciblage pour que la requête reste la seule règle.
          or(
            eq(sql`cardinality(${announcements.audience})`, 0),
            arrayContains(announcements.audience, [role]),
          ),
        ),
      )
      .orderBy(desc(announcements.startsAt));
  }

  async save(input: Partial<Announcement> & { id?: string }): Promise<Announcement> {
    const title = (input.title ?? "").trim();
    const bodyMd = (input.bodyMd ?? "").trim();

    if (title === "") throw new BadRequestException("Donnez un titre à l'annonce.");
    if (bodyMd === "") throw new BadRequestException("Une annonce sans texte n'annonce rien.");

    const level = input.level ?? "info";
    if (!LEVELS.has(level)) throw new BadRequestException("Niveau inconnu.");

    /*
     * Le public est **filtré**, pas refusé.
     *
     * La liste vient d'un écran qui peut porter un rôle retiré depuis. Faire
     * échouer l'enregistrement entier pour cela ferait perdre le reste de la
     * saisie ; garder un rôle inconnu ferait une annonce que personne ne verra.
     */
    const audience = (input.audience ?? []).filter((role) => ROLES.has(role));

    const startsAt = input.startsAt ?? new Date().toISOString();
    const endsAt = input.endsAt ?? null;

    // Une fenêtre qui se ferme avant de s'ouvrir ne s'affiche jamais : le dire
    // vaut mieux que de laisser chercher pourquoi l'annonce reste invisible.
    if (endsAt !== null && endsAt <= startsAt) {
      throw new BadRequestException("La fin doit venir après le début.");
    }

    const values = {
      title: title.slice(0, 255),
      bodyMd,
      level,
      startsAt,
      endsAt,
      audience,
      updatedAt: new Date().toISOString(),
    };

    if (input.id) {
      const [updated] = await this.db
        .update(announcements)
        .set(values)
        .where(eq(announcements.id, input.id))
        .returning({ id: announcements.id });

      if (!updated) throw new NotFoundException("Annonce inconnue.");
      return { id: updated.id, ...values };
    }

    const [created] = await this.db
      .insert(announcements)
      .values(values)
      .returning({ id: announcements.id });

    if (!created) throw new BadRequestException("L'annonce n'a pas pu être créée.");
    return { id: created.id, ...values };
  }

  /**
   * Retire une annonce.
   *
   * Supprimée et non archivée : une annonce est un message d'une durée, pas une
   * pièce d'archive. Qui veut garder la trace pose une date de fin.
   */
  async remove(id: string): Promise<void> {
    const removed = await this.db
      .delete(announcements)
      .where(eq(announcements.id, id))
      .returning({ id: announcements.id });

    if (removed.length === 0) throw new NotFoundException("Annonce inconnue.");
  }
}
