import { Inject, Injectable } from "@nestjs/common";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { MailerService } from "../mail/mailer.service";
import { BrandingService } from "../reseller/branding.service";
import { AuthTokenRepository } from "./auth-token.repository";

/**
 * Les deux courriers porteurs de jeton : réinitialisation et vérification.
 *
 * Ils vivaient dans le contrôleur d'authentification. Ils en sortent parce que
 * l'administration déclenche désormais les mêmes — « envoyer un lien de
 * réinitialisation » à un client, « revérifier » une adresse qu'elle vient de
 * changer — et qu'une seconde copie du texte ou de la règle du domaine de lien
 * finirait par diverger. C'est la règle du domaine qui compte : un jeton ne
 * part jamais vers un hôte que l'appelant aurait choisi.
 */

/** Issue d'un envoi. Le public n'en voit rien ; l'administration, tout. */
export type AccountMailOutcome =
  /** Le courrier est parti (ou du moins a été confié au SMTP). */
  | "sent"
  /** Aucun SMTP configuré : aucun jeton n'a été émis. */
  | "mail_disabled"
  /** Plafond d'émission atteint pour ce compte : rien n'a été émis. */
  | "throttled";

@Injectable()
export class AccountMailService {
  constructor(
    @Inject(AuthTokenRepository) private readonly tokens: AuthTokenRepository,
    @Inject(MailerService) private readonly mail: MailerService,
    @Inject(PlatformSettingsService) private readonly platform: PlatformSettingsService,
    @Inject(BrandingService) private readonly branding: BrandingService,
  ) {}

  /**
   * Émet un jeton de réinitialisation et l'envoie.
   *
   * Sans SMTP, **aucun jeton** : un jeton que personne ne recevra invaliderait
   * les précédents et ferait croire au journal qu'une réinitialisation est en
   * cours. L'envoi n'est pas attendu — un SMTP lent ne doit pas faire attendre
   * la page — mais il est confié avant de rendre la main.
   */
  async sendPasswordReset(
    user: { id: string; email: string },
    host: string | null,
    ip: string | null,
  ): Promise<AccountMailOutcome> {
    if (!(await this.mail.isConfigured())) return "mail_disabled";

    const issued = await this.tokens.issue(user.id, "password_reset", ip);
    if (!issued) return "throttled";

    void this.mail.send({
      to: user.email,
      subject: "Réinitialisation de votre mot de passe",
      text: await this.resetMessage(issued.token, host),
    });
    return "sent";
  }

  /** Émet un jeton de vérification d'adresse et l'envoie. Même règles. */
  async sendEmailVerification(
    user: { id: string; email: string },
    host: string | null,
    ip: string | null,
  ): Promise<AccountMailOutcome> {
    if (!(await this.mail.isConfigured())) return "mail_disabled";

    const issued = await this.tokens.issue(user.id, "email_verify", ip);
    if (!issued) return "throttled";

    void this.mail.send({
      to: user.email,
      subject: "Confirmez votre adresse e-mail",
      text: await this.verifyMessage(issued.token, host),
    });
    return "sent";
  }

  /**
   * Domaine sur lequel un lien porteur de jeton peut être émis.
   *
   * L'hôte d'arrivée vient d'un en-tête que le navigateur peut forger : il ne
   * sert de domaine de lien que s'il désigne un revendeur au domaine
   * **vérifié** (`forHost` ne renvoie un `resellerId` que dans ce cas). Tout
   * autre hôte retombe sur le domaine de la plateforme, sans quoi un jeton de
   * réinitialisation partirait vers l'adresse choisie par l'attaquant.
   */
  private async linkDomain(host: string | null, resellerId: string | null): Promise<string> {
    if (host !== null && resellerId !== null) return host;
    return await this.platform.text("brand.domain");
  }

  /**
   * Le courrier de réinitialisation, en texte brut.
   *
   * Il dit trois choses, et pas une de plus : ce qui a été demandé, le lien, et
   * quoi faire si l'on n'a rien demandé. Cette dernière phrase n'est pas une
   * politesse — c'est ainsi que quelqu'un apprend qu'un autre s'intéresse à son
   * compte.
   *
   * Le lien repart vers le domaine **par lequel on est venu** : un client d'un
   * revendeur ne doit pas découvrir, dans un lien qu'il est censé suivre en
   * confiance, une marque qu'il ne connaît pas.
   */
  private async resetMessage(token: string, host: string | null): Promise<string> {
    const branding = await this.branding.forHost(host);
    const domain = await this.linkDomain(host, branding.resellerId);
    const link = `https://${domain}/reset?token=${encodeURIComponent(token)}`;

    return [
      `Une réinitialisation de mot de passe a été demandée pour votre compte ${branding.name}.`,
      "",
      "Ouvrez ce lien pour en choisir un nouveau :",
      link,
      "",
      "Le lien est valable une heure et ne peut servir qu'une fois.",
      "",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message :",
      "votre mot de passe actuel reste valable, et personne n'a eu accès à votre compte.",
      "",
    ].join("\n");
  }

  private async verifyMessage(token: string, host: string | null): Promise<string> {
    // Même règle que la réinitialisation : le lien et la marque suivent le
    // domaine d'arrivée, pas celui de la plateforme.
    const branding = await this.branding.forHost(host);
    const domain = await this.linkDomain(host, branding.resellerId);
    const link = `https://${domain}/verify?token=${encodeURIComponent(token)}`;

    return [
      `Confirmez que cette adresse est bien la vôtre pour votre compte ${branding.name}.`,
      "",
      "Ouvrez ce lien :",
      link,
      "",
      "Le lien est valable vingt-quatre heures et ne peut servir qu'une fois.",
      "",
      "Si vous n'avez pas de compte chez nous, ignorez ce message : sans ce clic,",
      "l'adresse ne sera rattachée à aucun compte.",
      "",
    ].join("\n");
  }
}
