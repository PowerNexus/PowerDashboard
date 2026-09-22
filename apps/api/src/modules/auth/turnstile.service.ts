import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformSettingsService } from "../admin/platform-settings.service";

/**
 * Contrôle anti-automate à l'entrée (Turnstile).
 *
 * **Le réglage seul ne protège rien, et le panel refuse de faire semblant.**
 * Cocher « captcha à la connexion » sans renseigner les deux clés laissait
 * jusqu'ici croire à une protection qui n'existait pas — l'interrupteur ne
 * commandait aucune ligne de code. Désormais il commande, et quand les clés
 * manquent il laisse explicitement passer plutôt que de verrouiller la
 * connexion de tout le monde sur une vérification impossible.
 *
 * Les deux défauts possibles ont été pesés :
 *
 * - **fermer** quand la vérification est impossible enferme dehors
 *   l'administrateur qui vient de cocher la case, y compris lui-même ;
 * - **ouvrir** laisse une porte au même niveau de protection qu'avant.
 *
 * On ouvre, et on le dit — dans le journal à chaque démarrage concerné, et
 * dans la description du réglage. Un panel dont personne ne peut plus se
 * connecter est une panne ; un panel sans captcha est l'état d'hier.
 */

/** Adresse de vérification, imposée par Cloudflare. */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Court : ce contrôle est sur le chemin de la connexion.
 *
 * Un service de vérification qui traîne ne doit pas rendre le panel
 * inutilisable ; passé ce délai, on refuse la tentative — et non on l'accepte,
 * car ici l'échec porte sur une preuve qu'on nous a promise.
 */
const TIMEOUT_MS = 5_000;

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * La clé publique à mettre dans la page, ou `null` quand il n'y a rien à
   * afficher.
   *
   * Servie sur une route publique : c'est une clé de site, faite pour être lue
   * par tous les navigateurs. C'est aussi ce qui permet à l'écran de connexion
   * de ne pas rendre un contrôle que l'API n'exigera pas — un captcha affiché
   * mais ignoré apprend à ne plus le remplir.
   */
  async siteKey(): Promise<string | null> {
    if (!(await this.settings.boolean("security.captchaOnLogin"))) return null;

    const site = (await this.settings.text("security.captchaSiteKey")).trim();
    const secret = (await this.settings.secret("security.captchaSecretKey")).trim();

    // Les deux clés, ou rien : une clé de site sans secret afficherait un
    // contrôle que le panel ne saurait pas vérifier.
    return site !== "" && secret !== "" ? site : null;
  }

  /**
   * Vérifie un jeton, ou dit pourquoi c'est impossible.
   *
   * Rend `true` quand la tentative peut se poursuivre — ce qui recouvre deux
   * cas différents : la preuve est bonne, **ou** aucune preuve n'était exigée.
   * L'appelant n'a pas à les distinguer, et les séparer l'obligerait à
   * réimplémenter la décision à chaque route.
   */
  async accepts(token: string | null, ip: string | null): Promise<boolean> {
    const site = await this.siteKey();
    if (site === null) return true;

    if (!token) return false;

    const secret = (await this.settings.secret("security.captchaSecretKey")).trim();
    const body = new URLSearchParams({ secret, response: token });
    // L'adresse est transmise quand on l'a : Cloudflare s'en sert pour son
    // propre jugement, et l'omettre affaiblit le contrôle sans rien simplifier.
    if (ip) body.set("remoteip", ip);

    try {
      const response = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(`Turnstile a répondu HTTP ${response.status} : tentative refusée.`);
        return false;
      }

      const verdict = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
      if (verdict.success === true) return true;

      // Les codes d'erreur ne remontent pas au client : ils diraient à qui
      // essaie si son jeton est périmé, déjà employé ou fabriqué, ce qui
      // renseigne exactement la personne qu'on cherche à gêner.
      this.logger.warn(
        `Turnstile a refusé : ${(verdict["error-codes"] ?? []).join(", ") || "sans motif"}.`,
      );
      return false;
    } catch (error) {
      this.logger.warn(
        `Turnstile injoignable : ${error instanceof Error ? error.message : "erreur inconnue"}.`,
      );
      // Refus, et non tolérance : la preuve avait été exigée et annoncée à
      // l'écran. La laisser tomber au premier incident réseau ferait du
      // contrôle une formalité qu'il suffit de faire échouer.
      return false;
    }
  }
}
