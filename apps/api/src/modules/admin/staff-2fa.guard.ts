import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { SessionUser } from "../auth/session.repository";
import { TwoFactorRepository } from "../auth/two-factor.repository";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * Le personnel ne consulte pas l'administration sans seconde preuve.
 *
 * **Le réglage existait et n'imposait rien.** « 2FA obligatoire pour le
 * personnel » figurait dans les paramètres de la plateforme, actif par défaut,
 * lu par aucun code : un administrateur cochait une protection et repartait en
 * la croyant acquise. Un interrupteur de sécurité qui ne fait rien est pire
 * qu'un interrupteur absent — il détourne l'attention de la vraie décision.
 *
 * Le refus porte sur l'**espace d'administration**, et pas sur la connexion :
 * un compte sans seconde preuve doit pouvoir entrer dans son espace client pour
 * aller l'activer. Barrer la porte d'entrée enfermerait dehors la personne qui
 * vient réparer précisément cela.
 *
 * 403 et non 404, contrairement à `AdminGuard` : ici l'appelant **est**
 * administrateur, il connaît déjà l'existence de ces routes. Lui répondre
 * « introuvable » l'enverrait chercher une panne là où il y a une règle.
 */
@Injectable()
export class StaffTwoFactorGuard implements CanActivate {
  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(TwoFactorRepository) private readonly twoFactor: TwoFactorRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    const user = request.user;
    if (!user) return true; // `SessionGuard` a déjà tranché : on ne double pas son refus.

    if (!(await this.settings.boolean("security.staffRequires2fa"))) return true;

    const status = await this.twoFactor.status(user.id);
    if (status.enabled) return true;

    throw new ForbiddenException(
      "Cette plateforme exige une seconde preuve d'identité pour accéder à l'administration. " +
        "Activez-la depuis la sécurité de votre compte.",
    );
  }
}
