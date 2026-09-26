import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  type Branding,
  type BrandingOverrides,
  composeBranding,
  isSafeBrandUrl,
  isValidDomain,
  isValidReplyTo,
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
import { and, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
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

/**
 * Domaines déclarés non vérifiés rendus à l'agent de certificats, au plus.
 * Chacun coûte un bloc nginx : la borne tient la configuration de la machine
 * web à une taille raisonnable, quoi que déclarent les revendeurs.
 */
export const MAX_DOMAINES_EN_ATTENTE = 200;

/** Sans déclaration ni vérification depuis ce délai, un domaine est abandonné. */
export const ABANDON_DOMAINE_MS = 30 * 24 * 60 * 60 * 1000;

/** Une ligne de la file de l'agent de certificats. */
export interface CertificateQueueEntry {
  domain: string;
  /**
   * Faux pour un domaine déclaré mais pas encore vérifié : l'agent ne lui pose
   * que la page d'attente, jamais de demande de certificat.
   */
  verified: boolean;
  pending: boolean;
  issuedAt: string | null;
  expiresAt: string | null;
  attemptedAt: string | null;
  failure: string | null;
}

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
      replyTo: row?.replyTo ?? "",
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
    return (await this.saveWithBases(userId, input, {})).overrides;
  }

  /**
   * Enregistre la personnalisation, **sans écraser une image posée entre-temps**.
   *
   * Le formulaire renvoie l'état chargé à l'ouverture de la page. Or un envoi
   * de fichier (`BrandImagesService.uploadForReseller`) écrit `logoUrl` ou
   * `faviconUrl` lui-même : depuis un autre onglet, un autre poste, ou un envoi
   * encore en vol au clic sur « Enregistrer ». Sans garde, l'ancienne adresse
   * revenait par-dessus, et `prune` effaçait l'image tout juste envoyée.
   *
   * Pour chaque champ d'image, le formulaire joint donc sa **base** : la valeur
   * qu'il a vue en dernier côté serveur. Si la valeur en base n'est plus
   * celle-là, elle est gardée et la valeur reçue ignorée — pour ce champ
   * seulement, les autres s'enregistrent. Les champs restent modifiables à la
   * main : une base à jour laisse poser une adresse externe ou vider le champ.
   * Sans base, rien ne change (appels existants).
   *
   * La condition est **dans l'écriture même** (`CASE` du `ON CONFLICT DO
   * UPDATE`, évalué sur la ligne verrouillée) : une lecture suivie d'une
   * écriture laisserait passer un envoi entre les deux.
   */
  async saveWithBases(
    userId: string,
    input: Partial<BrandingOverrides>,
    bases: BrandImageBases,
  ): Promise<{ overrides: BrandingOverrides; keptImages: BrandImageField[] }> {
    const accent = (input.accent ?? "").trim();
    if (accent !== "" && normalizeHex(accent) === null) {
      throw new BadRequestException(
        "La couleur doit être en notation hexadécimale, comme #0ea5e9.",
      );
    }

    const replyTo = (input.replyTo ?? "").trim();
    if (!isValidReplyTo(replyTo)) {
      throw new BadRequestException(
        "L'adresse de réponse doit être une seule adresse e-mail, comme support@exemple.fr.",
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
      replyTo,
      updatedAt: new Date().toISOString(),
    };

    // Une base fournie rend l'écriture du champ conditionnelle. À l'insertion,
    // la valeur « en base » est vide : une base non vide y est déjà périmée.
    const guarded = (field: BrandImageField): string | SQL => {
      const base = bases[field];
      if (base === undefined) return values[field];
      const column = resellerBrandings[field];
      return sql`CASE WHEN coalesce(${column}, '') = ${base} THEN ${values[field]} ELSE ${column} END`;
    };
    const atInsert = (field: BrandImageField): string => {
      const base = bases[field];
      return base === undefined || base === "" ? values[field] : "";
    };
    const inserted = {
      ...values,
      logoUrl: atInsert("logoUrl"),
      faviconUrl: atInsert("faviconUrl"),
    };
    const update = { ...values, logoUrl: guarded("logoUrl"), faviconUrl: guarded("faviconUrl") };

    const [stored] = await this.db
      .insert(resellerBrandings)
      .values({ userId, ...inserted })
      .onConflictDoUpdate({ target: resellerBrandings.userId, set: update })
      .returning({ logoUrl: resellerBrandings.logoUrl, faviconUrl: resellerBrandings.faviconUrl });

    // Gardé : une base était fournie et la valeur servie n'est pas celle reçue.
    const keptImages = BRAND_IMAGE_FIELDS.filter(
      (field) => bases[field] !== undefined && (stored?.[field] ?? "") !== values[field],
    );

    // Le domaine du revendeur sert peut-être déjà l'ancienne marque : sans
    // cette purge, son changement n'apparaîtrait qu'à la minute suivante, et il
    // rechargerait la page en croyant que l'enregistrement a échoué.
    this.forget((await this.domainState(userId)).domain);
    return { overrides: await this.overridesFor(userId), keptImages };
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
      // Le certificat suit le nom, pas la ligne : celui de l'ancien domaine
      // laissé en place faisait croire le nouveau déjà servi, et l'agent ne
      // lui demandait jamais de certificat.
      certificateIssuedAt: null,
      certificateExpiresAt: null,
      certificateAttemptedAt: null,
      certificateFailure: null,
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
   * Les domaines vérifiés, avec l'état de leur certificat, puis les domaines
   * déclarés pas encore vérifiés (`verified: false`, jamais `pending`) : voir
   * `awaitingVerification`.
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
  async certificateQueue(): Promise<CertificateQueueEntry[]> {
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
          // est à ce revendeur. Il vient à part, plus bas, sans `pending`.
          isNotNull(resellerBrandings.domainVerifiedAt),
        ),
      );

    const maintenant = Date.now();
    const TRENTE_JOURS = 30 * 24 * 60 * 60 * 1000;
    const UNE_HEURE = 60 * 60 * 1000;

    const verifies = rows.flatMap((row): CertificateQueueEntry[] => {
      if (!row.domain) return [];

      const expire = row.expiresAt === null ? null : new Date(row.expiresAt).getTime();
      const tente = row.attemptedAt === null ? null : new Date(row.attemptedAt).getTime();

      const besoin =
        row.issuedAt === null || (expire !== null && expire - maintenant < TRENTE_JOURS);

      // Un échec récent met le domaine au repos, quel que soit son besoin.
      const enRepos = row.failure !== null && tente !== null && maintenant - tente < UNE_HEURE;

      const pending = besoin && !enRepos;

      return [{ ...row, domain: row.domain, verified: true, pending }];
    });

    return [...verifies, ...(await this.awaitingVerification(maintenant))];
  }

  /**
   * Les domaines déclarés **pas encore vérifiés**, pour la page d'attente.
   *
   * Sans bloc à leur nom, leurs requêtes tombent sur le `default_server` de
   * nginx — la page d'erreur nue, ou pire, un autre site de la machine. L'agent
   * leur pose donc un bloc de port 80 seul, sans certificat, qui ne sert que la
   * page d'attente neutre et le défi ACME.
   *
   * Rien ne prouve encore que ces noms sont au revendeur : ce qu'ils ouvrent est
   * borné ici, et l'agent refuse en plus tout nom qu'un autre site de la
   * machine sert déjà.
   *
   * - `pending` toujours faux : aucun certificat n'est demandé pour eux. Un
   *   agent plus ancien, qui ne connaît pas `verified`, les ignore donc.
   * - Seuls les noms qui passent `isValidDomain`, en minuscules, et jamais le
   *   domaine de la plateforme ni l'un de ses sous-domaines.
   * - Abandonné — ni déclaré ni retenté depuis trente jours — il sort de la
   *   liste, et l'agent retire son bloc comme celui d'un domaine supprimé.
   * - Au plus `MAX_DOMAINES_EN_ATTENTE`, les plus récemment actifs d'abord.
   */
  private async awaitingVerification(maintenant: number): Promise<CertificateQueueEntry[]> {
    const rows = await this.db
      .select({
        domain: resellerBrandings.domain,
        checkedAt: resellerBrandings.domainCheckedAt,
        updatedAt: resellerBrandings.updatedAt,
      })
      .from(resellerBrandings)
      .where(
        and(
          isNotNull(resellerBrandings.domain),
          // Un domaine déclaré porte toujours son jeton de preuve.
          isNotNull(resellerBrandings.domainToken),
          isNull(resellerBrandings.domainVerifiedAt),
        ),
      );

    const plateforme = ((await this.settings.text("brand.domain")) || "").trim().toLowerCase();

    return rows
      .flatMap((row) => {
        const domain = row.domain?.trim().toLowerCase() ?? "";
        if (!isValidDomain(domain) || domain !== row.domain) return [];
        if (plateforme && (domain === plateforme || domain.endsWith(`.${plateforme}`))) return [];

        // `setDomain` efface `domainCheckedAt` : la déclaration compte alors.
        const actif = new Date(row.checkedAt ?? row.updatedAt).getTime();
        if (!Number.isFinite(actif) || maintenant - actif > ABANDON_DOMAINE_MS) return [];

        return [{ domain, actif }];
      })
      .sort((a, b) => b.actif - a.actif)
      .slice(0, MAX_DOMAINES_EN_ATTENTE)
      .map(({ domain }) => ({
        domain,
        verified: false,
        pending: false,
        issuedAt: null,
        expiresAt: null,
        attemptedAt: null,
        failure: null,
      }));
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
      replyTo: row.replyTo,
    };
  }

  /**
   * Marque et domaine à employer pour un courriel **sans requête** : une
   * notification sur un serveur, écrite par une tâche de fond ou un daemon.
   *
   * La règle reste « le domaine décide » (`composeBranding`) : un revendeur
   * ne prête sa marque que s'il a un domaine **vérifié**, celui où ses clients
   * voient déjà cette marque. Ce n'est pas la marque déduite d'un compte — un
   * client peut louer chez deux revendeurs — mais celle du **serveur**, qui
   * n'en a qu'un. Sans domaine vérifié, c'est la plateforme, avec son domaine.
   */
  async forReseller(
    resellerId: string | null,
  ): Promise<{ branding: Branding; domain: string | null }> {
    if (resellerId) {
      const [row] = await this.db
        .select({ domain: resellerBrandings.domain })
        .from(resellerBrandings)
        .where(
          and(
            eq(resellerBrandings.userId, resellerId),
            isNotNull(resellerBrandings.domainVerifiedAt),
          ),
        )
        .limit(1);
      if (row?.domain) return { branding: await this.forHost(row.domain), domain: row.domain };
    }

    const domain = normalizeHost(await this.settings.text("brand.domain")) || null;
    return { branding: await this.forHost(domain), domain };
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

/**
 * Champs de marque lus dans le corps d'une requête : les chaînes seules, tout
 * le reste vide.
 *
 * **Tous** les champs de `BrandingOverrides`, et c'est le sens de cette
 * fonction : la route du revendeur recopiait les champs un par un et avait
 * oublié `replyTo`. Le formulaire l'envoyait, la route le jetait, et chaque
 * enregistrement effaçait l'adresse de réponse — sans le moindre message.
 */
export function brandingInput(body: unknown): BrandingOverrides {
  const payload = (body ?? {}) as Record<string, unknown>;
  const text = (key: keyof BrandingOverrides): string =>
    typeof payload[key] === "string" ? (payload[key] as string) : "";

  const fields: Record<keyof BrandingOverrides, true> = {
    name: true,
    logoUrl: true,
    faviconUrl: true,
    accent: true,
    supportUrl: true,
    termsUrl: true,
    footerText: true,
    loginTagline: true,
    replyTo: true,
  };
  return Object.fromEntries(
    (Object.keys(fields) as (keyof BrandingOverrides)[]).map((key) => [key, text(key)]),
  ) as unknown as BrandingOverrides;
}

/** Les champs d'image, que l'envoi par fichier écrit lui-même. */
export const BRAND_IMAGE_FIELDS = ["logoUrl", "faviconUrl"] as const;
export type BrandImageField = (typeof BRAND_IMAGE_FIELDS)[number];

/** Dernière valeur vue par le formulaire, par champ d'image (voir `saveWithBases`). */
export type BrandImageBases = Partial<Record<BrandImageField, string>>;

/**
 * Bases lues dans le corps (`imageBases`). Absentes, rien ne change : un champ
 * sans base s'enregistre comme avant.
 */
export function brandImageBases(body: unknown): BrandImageBases {
  return readImageBases((body as { imageBases?: unknown } | null)?.imageBases, BRAND_IMAGE_FIELDS);
}

/**
 * Bases d'images lues dans un corps de requête, pour les clés données.
 *
 * Une base **malformée est refusée** (400), jamais ignorée : l'ignorer rendait
 * l'écriture du champ inconditionnelle — précisément ce que la base devait
 * empêcher —, et la traiter comme vide laisserait passer l'écriture chaque
 * fois que le champ est vide en base. Un client qui joint une base entend une
 * écriture conditionnelle ; s'il la forme mal, mieux vaut qu'il l'apprenne que
 * d'écraser une image sans le savoir. Une clé absente (ou `undefined`) reste
 * « sans base ».
 */
export function readImageBases<K extends string>(
  raw: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Bases d'images malformées : un objet de chaînes est attendu.");
  }
  const bases: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new BadRequestException(`Base d'image malformée pour « ${key} » : chaîne attendue.`);
    }
    bases[key] = value.trim();
  }
  return bases;
}

/** Hôte comparable : sans port, sans casse, sans point final. */
export function normalizeHost(host: string | null): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}
