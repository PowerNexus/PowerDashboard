import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import {
  PlatformSettingsService,
  type SmtpConfiguration,
} from "../admin/platform-settings.service";

/**
 * Envoi de courrier.
 *
 * Une bibliothèque plutôt que le protocole à la main, contrairement au JWT
 * signé à dix lignes ailleurs dans ce projet : SMTP, ce sont la négociation
 * STARTTLS, l'authentification, l'encodage MIME et l'échappement du point en
 * début de ligne. Chacun de ces points a sa façon de produire un courrier qui
 * part sans erreur et n'arrive jamais.
 *
 * **Le panel n'échoue jamais parce qu'un courrier n'est pas parti.** Un envoi
 * raté est journalisé et rien de plus : refuser une réinitialisation de mot de
 * passe parce que le serveur SMTP est tombé enfermerait dehors quelqu'un qui a
 * déjà perdu son mot de passe. Les appelants le savent et n'attendent pas de
 * confirmation.
 */

/**
 * Au-delà, l'envoi est abandonné.
 *
 * Dix secondes : un serveur SMTP qui ne répond pas dans ce délai ne répondra
 * pas mieux dans trente, et la requête qui attend derrière est celle de
 * quelqu'un devant son écran.
 */
const TIMEOUT_MS = 10_000;

export interface Mail {
  to: string;
  subject: string;
  /** Corps en texte brut. Voir `send` pour la raison. */
  text: string;
  /**
   * Nom d'expéditeur affiché, tiré de la marque (`mailSender`). L'adresse,
   * elle, reste celle des réglages SMTP : c'est elle que SPF et DKIM couvrent.
   */
  fromName?: string;
  /** Adresse de réponse de la marque, quand elle en déclare une. */
  replyTo?: string | null;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Le courrier part-il ?
   *
   * Question posée avant de proposer une fonction qui en dépend : offrir
   * « mot de passe oublié » sur un panel sans SMTP mène à un formulaire qui
   * remercie poliment sans rien envoyer.
   */
  async isConfigured(): Promise<boolean> {
    return (await this.settings.smtpConfiguration()) !== null;
  }

  /**
   * Envoie, ou renonce en silence.
   *
   * Le corps est en **texte brut**, sans HTML, et ce n'est pas une économie :
   * ces courriers portent un lien à cliquer et rien d'autre. Un modèle HTML
   * ajouterait une mise en page à maintenir, des images qui ne chargent pas, et
   * la ressemblance exacte avec l'hameçonnage que ces messages doivent éviter.
   *
   * Rend `true` quand le serveur SMTP a accusé réception — ce qui ne dit pas
   * que le courrier est arrivé, seulement qu'il est parti.
   */
  async send(mail: Mail): Promise<boolean> {
    return (await this.sendAndReport(mail)).ok;
  }

  /**
   * Le même envoi, mais qui **rend la cause de l'échec**.
   *
   * Les appelants ordinaires n'en veulent pas : un mot de passe oublié ne doit
   * pas afficher « 535 authentication failed » au client, qui n'y peut rien et
   * à qui cela apprendrait le nom du fournisseur de courrier.
   *
   * L'exploitant, lui, n'a que cela d'utile. Un SMTP mal réglé se diagnostique
   * par la phrase du serveur — « authentification refusée », « certificat
   * expiré », « relais interdit » — et la remplacer par « échec » oblige à
   * ouvrir un journal auquel il n'a pas forcément accès.
   */
  async sendAndReport(mail: Mail): Promise<{ ok: boolean; error: string | null }> {
    const config = await this.settings.smtpConfiguration();
    if (!config) {
      this.logger.warn(`Courrier « ${mail.subject} » non envoyé : SMTP non configuré.`);
      return { ok: false, error: "Aucun serveur d'envoi n'est configuré." };
    }

    try {
      await this.transportFor(config).sendMail({
        // Objet plutôt que chaîne composée : nodemailer encode et met entre
        // guillemets le nom lui-même, et une virgule ou un accent dans le nom
        // d'un revendeur ne peut pas fabriquer un second expéditeur.
        from: mail.fromName ? { name: mail.fromName, address: config.from } : config.from,
        ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
      return { ok: true, error: null };
    } catch (error) {
      const cause = error instanceof Error ? error.message : "cause inconnue";
      // L'adresse du destinataire n'est **pas** journalisée : un journal
      // d'exploitation n'a pas à devenir un annuaire des clients.
      this.logger.error(`Envoi de « ${mail.subject} » refusé par ${config.host} : ${cause}`);
      return { ok: false, error: cause };
    }
  }

  /**
   * Transport, refabriqué quand la configuration change.
   *
   * Le garder ouvert évite une poignée de main TLS par courrier ; le comparer à
   * la configuration courante évite qu'un changement de serveur dans l'écran
   * d'administration reste sans effet jusqu'au prochain redémarrage — un défaut
   * qui se diagnostique très mal, puisque le réglage affiché est le bon.
   */
  private cached: { key: string; transport: Transporter } | null = null;

  private transportFor(config: SmtpConfiguration): Transporter {
    const key = JSON.stringify(config);
    if (this.cached?.key === key) return this.cached.transport;

    const transport = createTransport({
      host: config.host,
      port: config.port,
      // 465 est le port du TLS implicite ; partout ailleurs on part en clair et
      // on monte en TLS par STARTTLS, ce que `nodemailer` fait de lui-même.
      secure: config.port === 465,
      // STARTTLS exigé, pas seulement proposé : sans cela, un intermédiaire
      // qui retire l'annonce STARTTLS fait partir les liens de réinitialisation
      // en clair. Hors production le relais de développement n'a pas de TLS.
      requireTLS: config.port !== 465 && process.env.NODE_ENV === "production",
      ...(config.username ? { auth: { user: config.username, pass: config.password ?? "" } } : {}),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });

    this.cached = { key, transport };
    return transport;
  }
}
