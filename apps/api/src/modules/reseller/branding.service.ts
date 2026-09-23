import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  type Branding,
  type BrandingOverrides,
  composeBranding,
  isSafeBrandUrl,
  isValidDomain,
  normalizeHex,
  ownershipRecordName,
  PLATFORM_BRAND_SETTINGS,
} from "@gamedashboard/contracts";
import { type Database, resellerBrandings, users } from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNotNull } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { PlatformSettingsService } from "../admin/platform-settings.service";

/**
 * Marque blanche des revendeurs, et domaines propres.
 *
 * Deux choses vivent ici, et elles sont inséparables : ce qu'un revendeur
 * affiche, et **l'adresse à laquelle on le voit**. Sans domaine propre, la
 * personnalisation ne s'appliquerait nulle part — c'est le domaine qui choisit
 * la marque servie à une requête, avant toute session.
 *
 * **Le certificat TLS ne se délivre pas ici, mais il se suit ici.** Obtenir un
 * certificat demande le serveur web et les droits de root, qui ne sont pas du
 * ressort du panel. Un agent tourne donc sur la machine web
 * (`infra/prod/certificates.sh`) : il demande la file, appelle certbot, et rend
 * compte. Ce service tient la file et le compte rendu — c'est-à-dire tout ce
 * que le panel peut honnêtement savoir de l'état d'un certificat.
 */

/** Durée de vie du cache de résolution par domaine. */
const CACHE_TTL_MS = 60_000;

export interface DomainState {
  domain: string | null;
  token: string | null;
  verifiedAt: string | null;
  checkedAt: string | null;
  failure: string | null;
  /** Nom et valeur de l'enregistrement de preuve, à publier par le revendeur. */
  ownershipRecord: { name: string; value: string } | null;
  /** Cible du CNAME : le domaine de la plateforme. */
  cnameTarget: string;
}

@Injectable()
export class BrandingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Marque à servir pour un hôte donné.
   *
   * Appelée à **chaque rendu de page**, d'où le cache : sans lui, chaque
   * navigation coûterait une lecture de réglages et une lecture de marque, pour
   * des valeurs qui changent une fois par mois.
   *
   * Une minute : assez court pour qu'un revendeur voie son changement sans
   * comprendre pourquoi il attend, assez long pour que la rafale de requêtes
   * d'un chargement de page n'en paie qu'une.
   */
  private cache = new Map<string, { at: number; branding: Branding }>();

  async forHost(host: string | null): Promise<Branding> {
    const key = normalizeHost(host);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.branding;

    const platform = await this.platformOverrides();
    const reseller = key === "" ? null : await this.findByDomain(key);
    const branding = composeBranding(platform, reseller);

    this.cache.set(key, { at: Date.now(), branding });
    return branding;
  }

  /** Vide le cache d'un domaine : appelé après toute écriture du revendeur. */
  private forget(domain: string | null): void {
    if (domain) this.cache.delete(normalizeHost(domain));
  }

  /** Personnalisation d'un revendeur, telle qu'il l'a saisie — sans replis. */
  async overridesFor(userId: string): Promise<BrandingOverrides> {
    const [row] = await this.db
      .select()
      .from(resellerBrandings)
      .where(eq(resellerBrandings.userId, userId))
      .limit(1);

    return {
      name: row?.name ?? "",
      logoUrl: row?.logoUrl ?? "",
      faviconUrl: row?.faviconUrl ?? "",
      accent: row?.accent ?? "",
      supportUrl: row?.supportUrl ?? "",
      termsUrl: row?.termsUrl ?? "",
      footerText: row?.footerText ?? "",
      loginTagline: row?.loginTagline ?? "",
    };
  }

  /**
   * Enregistre la personnalisation d'un revendeur.
   *
   * Les adresses sont contrôlées : un logo servi en `http://` sur une page en
   * `https://` ne s'affiche pas, et un `javascript:` recopié dans un attribut
   * `src` est une injection. Seuls `https://` et les chemins internes passent.
   */
  async save(userId: string, input: Partial<BrandingOverrides>): Promise<BrandingOverrides> {
    const accent = (input.accent ?? "").trim();
    if (accent !== "" && normalizeHex(accent) === null) {
      throw new BadRequestException(
        "La couleur doit être en notation hexadécimale, comme #0ea5e9.",
      );
    }

    const values = {
      name: (input.name ?? "").trim().slice(0, 120),
      logoUrl: assertUrl(input.logoUrl, "logo"),
      faviconUrl: assertUrl(input.faviconUrl, "favicon"),
      accent,
      supportUrl: assertUrl(input.supportUrl, "lien d'assistance"),
      termsUrl: assertUrl(input.termsUrl, "lien des conditions"),
      footerText: (input.footerText ?? "").trim().slice(0, 255),
      loginTagline: (input.loginTagline ?? "").trim().slice(0, 255),
      updatedAt: new Date().toISOString(),
    };

    await this.db
      .insert(resellerBrandings)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: resellerBrandings.userId, set: values });

    // Le domaine du revendeur sert peut-être déjà l'ancienne marque : sans
    // cette purge, son changement n'apparaîtrait qu'à la minute suivante, et il
    // rechargerait la page en croyant que l'enregistrement a échoué.
    this.forget((await this.domainState(userId)).domain);
    return this.overridesFor(userId);
  }

  /** État du domaine, avec ce qu'il reste à publier chez le registraire. */
  async domainState(userId: string): Promise<DomainState> {
    const [row] = await this.db
      .select()
      .from(resellerBrandings)
      .where(eq(resellerBrandings.userId, userId))
      .limit(1);

    return {
      domain: row?.domain ?? null,
      token: row?.domainToken ?? null,
      verifiedAt: row?.domainVerifiedAt ?? null,
      checkedAt: row?.domainCheckedAt ?? null,
      failure: row?.domainFailure ?? null,
      ownershipRecord:
        row?.domain && row.domainToken
          ? { name: ownershipRecordName(row.domain), value: row.domainToken }
          : null,
      cnameTarget: (await this.settings.text("brand.domain")) || "",
    };
  }

  /**
   * Déclare un domaine, ou le retire quand il est vide.
   *
   * Le jeton est **retiré à chaque changement de domaine**, et la vérification
   * repart de zéro : un domaine vérifié hier n'atteste rien du nom saisi
   * aujourd'hui, et laisser la marque de vérification en place servirait la
   * marque du revendeur sur un nom qu'il ne possède peut-être pas.
   */
  async setDomain(userId: string, domain: string): Promise<DomainState> {
    const previous = await this.domainState(userId);
    const wanted = domain.trim().toLowerCase();

    if (wanted !== "" && !isValidDomain(wanted)) {
      throw new BadRequestException("Ce nom de domaine n'est pas valide.");
    }

    if (wanted !== "") {
      const [taken] = await this.db
        .select({ userId: resellerBrandings.userId })
        .from(resellerBrandings)
        .where(eq(resellerBrandings.domain, wanted))
        .limit(1);

      // Un domaine ne peut pas servir deux marques : c'est lui qui tranche, et
      // deux prétendants rendraient la résolution non déterministe.
      if (taken && taken.userId !== userId) {
        throw new ConflictException("Ce domaine est déjà déclaré sur cette plateforme.");
      }
    }

    const values = {
      domain: wanted === "" ? null : wanted,
      domainToken: wanted === "" ? null : randomBytes(16).toString("hex"),
      domainVerifiedAt: null,
      domainCheckedAt: null,
      domainFailure: null,
      updatedAt: new Date().toISOString(),
    };

    await this.db
      .insert(resellerBrandings)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: resellerBrandings.userId, set: values });

    this.forget(previous.domain);
    this.forget(wanted);
    return this.domainState(userId);
  }

  /**
   * Vérifie le domaine : possession **et** acheminement.
   *
   * Les deux, parce qu'ils répondent à deux questions différentes. Le TXT dit
   * « ce domaine est à moi » — sans lui, n'importe qui déclarerait le domaine
   * d'un autre et servirait sa propre marque dessus. Le CNAME dit « le trafic
   * arrivera bien ici » — sans lui, le panel reconnaîtrait un domaine qui ne
   * lui parvient jamais, et le revendeur chercherait la panne du mauvais côté.
   *
   * Les motifs d'échec sont distincts et conservés : « TXT introuvable » se
   * corrige chez le registraire, « CNAME vers autre chose » se corrige dans la
   * zone, et un message unique ferait chercher au mauvais endroit.
   */
  async verifyDomain(userId: string): Promise<DomainState> {
    const state = await this.domainState(userId);
    if (!state.domain || !state.token) {
      throw new BadRequestException("Déclarez d'abord un domaine.");
    }
    if (!state.cnameTarget) {
      throw new BadRequestException(
        "Le domaine de la plateforme n'est pas renseigné dans ses réglages : impossible d'indiquer une cible de CNAME.",
      );
    }

    const failure = await this.checkDns(state.domain, state.token, state.cnameTarget);
    const now = new Date().toISOString();

    await this.db
      .update(resellerBrandings)
      .set({
        domainVerifiedAt: failure === null ? now : null,
        domainCheckedAt: now,
        domainFailure: failure,
        updatedAt: now,
      })
      .where(eq(resellerBrandings.userId, userId));

    this.forget(state.domain);
    return this.domainState(userId);
  }

  /**
   * Domaines déclarés, vérifiés ou non, pour l'écran d'administration.
   *
   * Les non vérifiés y figurent aussi, et c'est le but : un domaine déclaré
   * qui ne se vérifie pas est exactement ce qu'un administrateur doit voir pour
   * aider le revendeur à corriger sa zone.
   */
  async declaredDomains(): Promise<
    {
      userId: string;
      email: string;
      domain: string;
      verifiedAt: string | null;
      certificateIssuedAt: string | null;
      certificateExpiresAt: string | null;
      certificateAttemptedAt: string | null;
      certificateFailure: string | null;
    }[]
  > {
    const rows = await this.db
      .select({
        userId: resellerBrandings.userId,
        email: users.email,
        domain: resellerBrandings.domain,
        verifiedAt: resellerBrandings.domainVerifiedAt,
        /*
         * L'état du certificat, rendu avec le domaine et non à part.
         *
         * Les deux ne se lisent que l'un contre l'autre : un domaine vérifié
         * sans certificat est un client qui tombe sur un avertissement de
         * sécurité, et c'est exactement ce que cet écran doit montrer.
         */
        certificateIssuedAt: resellerBrandings.certificateIssuedAt,
        certificateExpiresAt: resellerBrandings.certificateExpiresAt,
        certificateAttemptedAt: resellerBrandings.certificateAttemptedAt,
        certificateFailure: resellerBrandings.certificateFailure,
      })
      .from(resellerBrandings)
      .innerJoin(users, eq(users.id, resellerBrandings.userId))
      .where(isNotNull(resellerBrandings.domain));

    return rows.flatMap((row) => (row.domain ? [{ ...row, domain: row.domain }] : []));
  }

  /**
   * Les domaines vérifiés, avec l'état de leur certificat.
   *
   * `pending` dit s'il y a quelque chose à faire, et le dit **ici** plutôt que
   * dans l'agent : c'est le panel qui connaît la règle, et un agent qui la
   * réinventerait finirait par la lire autrement — en redemandant tous les
   * quarts d'heure un certificat que l'autorité vient de refuser, par exemple.
   *
   * Deux questions, dans cet ordre, et l'ordre est tout :
   *
   * 1. **Ce domaine a-t-il besoin de quelque chose ?** Aucun certificat, ou un
   *    certificat qui expire dans moins de trente jours.
   * 2. **A-t-on le droit de réessayer maintenant ?** Non, si la dernière
   *    tentative a échoué il y a moins d'une heure.
   *
   * La seconde s'applique à la première, et non l'inverse. Écrite dans l'autre
   * sens — « pas de certificat **ou** échec ancien » — elle laissait le premier
   * cas l'emporter : un domaine qui n'a jamais eu de certificat restait en
   * attente quoi qu'il arrive, donc retenté tous les quarts d'heure. C'est
   * exactement le domaine mal pointé, c'est-à-dire le cas courant, et Let's
   * Encrypt coupe après cinq échecs d'autorisation par heure — la retenue
   * n'existait qu'au moment précis où elle devait servir.
   */
  async certificateQueue(): Promise<
    {
      domain: string;
      pending: boolean;
      issuedAt: string | null;
      expiresAt: string | null;
      attemptedAt: string | null;
      failure: string | null;
    }[]
  > {
    const rows = await this.db
      .select({
        domain: resellerBrandings.domain,
        issuedAt: resellerBrandings.certificateIssuedAt,
        expiresAt: resellerBrandings.certificateExpiresAt,
        attemptedAt: resellerBrandings.certificateAttemptedAt,
        failure: resellerBrandings.certificateFailure,
      })
      .from(resellerBrandings)
      .where(
        and(
          isNotNull(resellerBrandings.domain),
          // Un domaine non vérifié ne doit surtout pas être tenté : on
          // demanderait un certificat pour un nom dont rien ne prouve qu'il
          // est à ce revendeur.
          isNotNull(resellerBrandings.domainVerifiedAt),
        ),
      );

    const maintenant = Date.now();
    const TRENTE_JOURS = 30 * 24 * 60 * 60 * 1000;
    const UNE_HEURE = 60 * 60 * 1000;

    return rows.flatMap((row) => {
      if (!row.domain) return [];

      const expire = row.expiresAt === null ? null : new Date(row.expiresAt).getTime();
      const tente = row.attemptedAt === null ? null : new Date(row.attemptedAt).getTime();

      const besoin =
        row.issuedAt === null || (expire !== null && expire - maintenant < TRENTE_JOURS);

      // Un échec récent met le domaine au repos, quel que soit son besoin.
      const enRepos = row.failure !== null && tente !== null && maintenant - tente < UNE_HEURE;

      const pending = besoin && !enRepos;

      return [{ ...row, domain: row.domain, pending }];
    });
  }

  /**
   * Enregistre l'issue d'une tentative.
   *
   * L'horodatage de tentative est posé **dans tous les cas**, réussite comprise :
   * c'est lui qui espace les reprises, et ne l'écrire qu'en cas d'échec ferait
   * qu'un agent relancé en boucle ne serait jamais freiné.
   *
   * En cas de réussite, l'échec précédent est effacé : le laisser afficherait
   * pour toujours la raison d'un problème résolu.
   */
  async recordCertificate(
    domain: string,
    result: { issuedAt?: string | null; expiresAt?: string | null; failure?: string | null },
  ): Promise<void> {
    const reussite = (result.failure ?? null) === null;

    const [updated] = await this.db
      .update(resellerBrandings)
      .set({
        certificateAttemptedAt: new Date().toISOString(),
        certificateFailure: result.failure ?? null,
        ...(reussite
          ? {
              certificateIssuedAt: result.issuedAt ?? new Date().toISOString(),
              certificateExpiresAt: result.expiresAt ?? null,
            }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(resellerBrandings.domain, domain),
          // Le périmètre est dans l'écriture : un domaine non vérifié n'a pas
          // de certificat à se voir attribuer, même par erreur d'un agent.
          isNotNull(resellerBrandings.domainVerifiedAt),
        ),
      )
      .returning({ userId: resellerBrandings.userId });

    if (!updated) throw new NotFoundException("Domaine vérifié introuvable.");

    // Le domaine change d.état : la résolution par hôte doit le relire.
    this.cache.clear();
  }

  /**
   * Les deux interrogations DNS, dans l'ordre où elles se corrigent.
   *
   * Rend le motif d'échec, ou `null` quand tout est en place. Aucune exception
   * ne remonte : un domaine inexistant, un serveur DNS muet et un
   * enregistrement manquant sont tous des états normaux de ce parcours.
   */
  private async checkDns(
    domain: string,
    token: string,
    cnameTarget: string,
  ): Promise<string | null> {
    let records: string[][] = [];
    try {
      records = await dns.resolveTxt(ownershipRecordName(domain));
    } catch {
      return `Aucun enregistrement TXT trouvé sur ${ownershipRecordName(domain)}. La propagation peut prendre quelques minutes.`;
    }

    // Un TXT long est découpé en morceaux par le protocole : ils se recollent
    // avant comparaison, sinon un jeton de 32 caractères passerait mais un
    // jeton plus long échouerait sans raison visible.
    const values = records.map((chunks) => chunks.join(""));
    if (!values.includes(token)) {
      return `L'enregistrement TXT de ${ownershipRecordName(domain)} ne porte pas le jeton attendu.`;
    }

    try {
      const targets = await dns.resolveCname(domain);
      const expected = cnameTarget.trim().toLowerCase().replace(/\.$/, "");
      const matches = targets.some(
        (target) => target.trim().toLowerCase().replace(/\.$/, "") === expected,
      );

      if (!matches) {
        return `Le CNAME de ${domain} pointe vers ${targets.join(", ") || "rien"} au lieu de ${expected}.`;
      }
    } catch {
      return `Aucun CNAME sur ${domain}. Il doit pointer vers ${cnameTarget}.`;
    }

    return null;
  }

  /** Marque d'un revendeur, cherchée par son domaine **vérifié**. */
  private async findByDomain(
    domain: string,
  ): Promise<(BrandingOverrides & { resellerId: string }) | null> {
    const [row] = await this.db
      .select()
      .from(resellerBrandings)
      .where(
        and(eq(resellerBrandings.domain, domain), isNotNull(resellerBrandings.domainVerifiedAt)),
      )
      .limit(1);

    if (!row) return null;
    return {
      resellerId: row.userId,
      name: row.name,
      logoUrl: row.logoUrl,
      faviconUrl: row.faviconUrl,
      accent: row.accent,
      supportUrl: row.supportUrl,
      termsUrl: row.termsUrl,
      footerText: row.footerText,
      loginTagline: row.loginTagline,
    };
  }

  /**
   * Oublie toutes les marques servies.
   *
   * Appelé quand la marque de la **plateforme** change : elle sert de repli à
   * chaque domaine, revendeurs compris, et purger un seul hôte laisserait les
   * autres afficher l'ancien logo pendant une minute.
   */
  forgetAll(): void {
    this.cache.clear();
  }

  /**
   * Marque de la plateforme, telle que ses réglages la décrivent.
   *
   * Tous les champs qu'un revendeur peut régler, et pas seulement le nom et
   * l'accent : longtemps, seuls ces deux-là étaient lus, si bien que la
   * plateforme ne pouvait ni poser son logo ni un lien d'assistance, alors
   * que n'importe lequel de ses revendeurs le pouvait. Le repli champ par
   * champ de `composeBranding` fait le reste — un revendeur qui n'a pas de
   * lien d'assistance hérite de celui de la plateforme.
   */
  private async platformOverrides(): Promise<Partial<BrandingOverrides>> {
    const entries = Object.entries(PLATFORM_BRAND_SETTINGS) as [keyof BrandingOverrides, string][];
    const values = await Promise.all(entries.map(([, key]) => this.settings.text(key)));
    return Object.fromEntries(entries.map(([field], index) => [field, values[index] ?? ""]));
  }
}

/**
 * Adresse acceptable pour une image ou un lien de marque — la règle vit dans
 * `isSafeBrandUrl`, partagée avec les réglages de la plateforme.
 */
function assertUrl(value: string | undefined, label: string): string {
  const trimmed = (value ?? "").trim();
  if (isSafeBrandUrl(trimmed)) return trimmed.slice(0, 500);

  throw new BadRequestException(
    `L'adresse du ${label} doit commencer par « https:// » ou par « / ».`,
  );
}

/** Hôte comparable : sans port, sans casse, sans point final. */
export function normalizeHost(host: string | null): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}
