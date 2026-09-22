import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { ActivityModule } from "../activity/activity.module";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { MailerService } from "../mail/mailer.service";
import { BrandingService } from "../reseller/branding.service";
import { ApiKeyRepository } from "./api-key.repository";
import { AuthController } from "./auth.controller";
import { AuthTokenRepository } from "./auth-token.repository";
import { BillingSsoService } from "./billing-sso.service";
import { BrowserSessionGuard } from "./browser-session.guard";
import { PasskeyRepository } from "./passkey.repository";
import { PasskeyService } from "./passkey.service";
import { SessionGuard } from "./session.guard";
import { SessionRepository } from "./session.repository";
import { SessionIssuerService } from "./session-issuer.service";
import { SshKeyRepository } from "./ssh-key.repository";
import { SsoService } from "./sso.service";
import { TurnstileService } from "./turnstile.service";
import { TwoFactorRepository } from "./two-factor.repository";
import { UserRepository } from "./user.repository";

@Module({
  imports: [ActivityModule],
  controllers: [AuthController],
  providers: [
    databaseProvider,
    UserRepository,
    SessionRepository,
    ApiKeyRepository,
    SessionGuard,
    BrowserSessionGuard,
    TwoFactorRepository,
    PasskeyRepository,
    PasskeyService,
    // Le service de réglages est fourni ici plutôt qu'importé du module
    // d'administration : celui-ci importe déjà AuthModule pour ses gardes, et
    // l'importer en retour formerait un cycle que Nest refuse.
    PlatformSettingsService,
    SsoService,
    AuthTokenRepository,
    // L'unique fabricant de sessions, partagé avec le contrôleur des
    // invitations : un second finirait par diverger d'un détail invisible.
    SessionIssuerService,
    // Le lien de connexion remis au plugin de facturation. Ici et non dans le
    // module applicatif : il émet et consomme un jeton d'authentification, et
    // l'y loger aurait formé un cycle, `ApplicationModule` important déjà
    // celui-ci.
    BillingSsoService,
    // Le mailer suit le même raisonnement que les réglages : fourni ici, et non
    // importé d'un module qui importe déjà celui-ci.
    MailerService,
    // Même raison encore : le module revendeur importe celui-ci pour ses
    // gardes. Le service est fourni ici, et les deux instances lisent la même
    // table — le cache d'une minute de chacune vaut celui de l'autre.
    BrandingService,
    SshKeyRepository,
    TurnstileService,
  ],
  // Exporté pour que le module client puisse protéger ses routes sans
  // redéclarer la logique de session.
  // `TwoFactorRepository` sort pour le garde qui exige une seconde preuve du
  // personnel : il lit l'état réel du compte, et une seconde instance ailleurs
  // lirait la même table sans rien apporter.
  exports: [
    SessionRepository,
    ApiKeyRepository,
    SessionGuard,
    TwoFactorRepository,
    // Sortent : l'émission du lien pour l'API applicative, l'ouverture de
    // session pour le contrôleur des invitations.
    SessionIssuerService,
    // Sort avec lui : le contrôleur des invitations crée le compte de l'invité
    // avant d'ouvrir sa session.
    UserRepository,
    BillingSsoService,
    databaseProvider,
  ],
})
export class AuthModule {}
