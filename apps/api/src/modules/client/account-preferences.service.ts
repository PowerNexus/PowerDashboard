import { type Database, users } from "@gamedashboard/db";
import { isLocale } from "@gamedashboard/i18n/locale";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Langue et fuseau du compte.
 *
 * Deux réglages qui appartiennent à la **personne**, pas à l'appareil : un
 * cookie de langue se perd au premier nettoyage de navigateur et ne suit pas
 * d'un téléphone à un ordinateur. Le panel est entièrement authentifié — il
 * sait toujours qui lit — et peut donc servir chacun dans sa langue sans la
 * faire figurer dans l'adresse.
 *
 * L'écran continue de poser un cookie en même temps : c'est lui que lit le
 * rendu côté serveur, à l'instant où la page se fabrique, avant toute lecture
 * de compte. La base reste la référence, le cookie n'en est que le reflet.
 */
@Injectable()
export class AccountPreferencesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async setLocale(userId: string, locale: unknown): Promise<{ locale: string }> {
    /*
     * La liste des langues vient du catalogue de traduction, jamais d'une
     * constante recopiée ici : accepter « de » parce que personne n'a pensé à
     * resserrer la validation donnerait un panel entièrement replié sur son
     * texte de repli, sans que rien ne dise pourquoi.
     */
    if (!isLocale(locale)) {
      throw new BadRequestException("Cette langue n'est pas servie par le panel.");
    }

    await this.db
      .update(users)
      .set({ locale, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    return { locale };
  }

  /**
   * Fuseau horaire, validé par la machine plutôt que par une liste.
   *
   * `Intl` connaît la base IANA et la tient à jour avec le moteur ; une liste
   * écrite à la main vieillirait à la première fusion de fuseaux, et refuserait
   * un identifiant parfaitement valide.
   */
  async setTimezone(userId: string, timezone: unknown): Promise<{ timezone: string }> {
    if (typeof timezone !== "string" || !isTimezone(timezone)) {
      throw new BadRequestException("Fuseau horaire inconnu.");
    }

    await this.db
      .update(users)
      .set({ timezone, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    return { timezone };
  }
}

export function isTimezone(value: string): boolean {
  try {
    // Lève `RangeError` sur un identifiant inconnu : c'est la validation.
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
