import { createHash, randomBytes } from "node:crypto";
import { normalizeSsoProfile, type SsoProfile } from "@gamedashboard/contracts";
import { type Database, userOauthAccounts, users } from "@gamedashboard/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { PlatformSettingsService, type SsoConfiguration } from "../admin/platform-settings.service";

/**
 * Authentification unique : le panel comme client OAuth 2.0.
 *
 * Le fournisseur est la source de vérité. Le panel n'invente aucune identité,
 * il reconnaît celles qu'on lui présente — et, une fois le réglage activé, il
 * n'en reconnaît plus d'autres.
 */

/**
 * Le fournisseur, tel que la liaison le nomme.
 *
 * « oidc » et non « google » : le panel expose **un** fournisseur configurable,
 * quel qu'il soit — Authentik, Keycloak, Azure, ou Google justement. Les
 * valeurs dédiées de l'énumération sont réservées aux boutons de marque prévus
 * au plan, qui auront leur propre cérémonie.
 */
const PROVIDER = "oidc" as const;

/** Départ d'une cérémonie : ce que le navigateur doit emporter. */
export interface SsoStart {
  url: string;
  state: string;
  /** Vérificateur PKCE. Ne quitte jamais le panel : seul son condensat part. */
  codeVerifier: string;
}

export class SsoDisabledError extends Error {
  constructor() {
    super("L'authentification unique n'est pas configurée.");
    this.name = "SsoDisabledError";
  }
}

export class SsoExchangeError extends Error {
  constructor(reason: string) {
    super(`Le fournisseur a refusé l'échange : ${reason}`);
    this.name = "SsoExchangeError";
  }
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  /** Configuration active, ou `null`. Sert aussi à savoir si le mot de passe est refusé. */
  configuration(): Promise<SsoConfiguration | null> {
    return this.settings.ssoConfiguration();
  }

  /**
   * Construit l'URL d'autorisation.
   *
   * PKCE est employé **même avec un secret client**, et ce n'est pas
   * redondant : le secret protège l'échange, le vérificateur protège le code
   * d'autorisation lui-même, qui transite par le navigateur et peut fuiter par
   * l'historique, un journal de proxy ou un en-tête `Referer`.
   */
  async start(redirectUri: string): Promise<SsoStart> {
    const config = await this.configuration();
    if (!config) throw new SsoDisabledError();

    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const url = new URL(config.authorizeUrl);
    // Les paramètres existants de l'URL configurée sont conservés : certains
    // fournisseurs en imposent (`tenant`, `audience`), et les écraser ferait
    // échouer la cérémonie sans rien indiquer.
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scopes,
      state,
      code_challenge: challenge,
      // S256 uniquement. `plain` transmettrait le vérificateur en clair, ce qui
      // revient à ne pas employer PKCE du tout.
      code_challenge_method: "S256",
    })) {
      url.searchParams.set(key, value);
    }

    return { url: url.toString(), state, codeVerifier };
  }

  /**
   * Échange le code contre un jeton, puis lit le profil.
   *
   * Le secret client part dans le corps de la requête, de serveur à serveur :
   * il ne traverse jamais le navigateur, qui n'a d'ailleurs jamais à le
   * connaître.
   */
  async profileFromCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<SsoProfile> {
    const config = await this.configuration();
    if (!config) throw new SsoDisabledError();

    const token = await this.exchange(config, code, codeVerifier, redirectUri);
    return this.fetchProfile(config, token);
  }

  private async exchange(
    config: SsoConfiguration,
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    });

    let response: Response;
    try {
      response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      });
    } catch {
      throw new SsoExchangeError(`${config.tokenUrl} est injoignable`);
    }

    if (!response.ok) {
      // Le corps de l'erreur peut contenir le secret renvoyé en écho par un
      // fournisseur bavard : seul le code de statut est journalisé.
      this.logger.error(`Échange SSO refusé par le fournisseur (${response.status}).`);
      throw new SsoExchangeError(`réponse ${response.status}`);
    }

    const payload = (await response.json().catch(() => ({}))) as { access_token?: unknown };
    if (typeof payload.access_token !== "string" || payload.access_token === "") {
      throw new SsoExchangeError("aucun jeton d'accès dans la réponse");
    }
    return payload.access_token;
  }

  private async fetchProfile(config: SsoConfiguration, accessToken: string): Promise<SsoProfile> {
    let response: Response;
    try {
      response = await fetch(config.userinfoUrl, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
    } catch {
      throw new SsoExchangeError(`${config.userinfoUrl} est injoignable`);
    }

    if (!response.ok) throw new SsoExchangeError(`profil refusé (${response.status})`);
    return normalizeSsoProfile(await response.json().catch(() => null));
  }

  /**
   * Retrouve ou crée le compte correspondant au profil.
   *
   * Trois cas, dans cet ordre, et l'ordre est la sécurité de la chose :
   *
   * 1. un compte porte déjà cet identifiant externe — c'est lui, sans
   *    ambiguïté ;
   * 2. une adresse **vérifiée par le fournisseur** correspond à un compte
   *    existant : les deux sont rapprochés plutôt que d'en créer un second ;
   * 3. sinon, un compte est créé.
   *
   * Le rapprochement du cas 2 n'a lieu **que** si le fournisseur affirme avoir
   * vérifié l'adresse. Sans ce contrôle, quiconque déclare chez un fournisseur
   * laxiste l'adresse de quelqu'un d'autre hériterait de son compte panel, de
   * ses serveurs et de ses sauvegardes.
   */
  async resolveUser(profile: SsoProfile): Promise<{ id: string; created: boolean }> {
    const [byExternal] = await this.db
      .select({ id: userOauthAccounts.userId })
      .from(userOauthAccounts)
      .where(
        and(
          eq(userOauthAccounts.provider, PROVIDER),
          eq(userOauthAccounts.providerUserId, profile.subject),
        ),
      )
      .limit(1);

    if (byExternal) {
      await this.refresh(byExternal.id, profile);
      return { id: byExternal.id, created: false };
    }

    if (profile.email && profile.emailVerified) {
      const [byEmail] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${profile.email})`)
        .limit(1);

      if (byEmail) {
        // Un compte déjà lié à **une autre** identité chez ce fournisseur n'est
        // pas rapproché : ce serait détourner le compte d'un tiers vers un
        // profil qui se trouve partager son adresse.
        const [dejaLie] = await this.db
          .select({ providerUserId: userOauthAccounts.providerUserId })
          .from(userOauthAccounts)
          .where(
            and(eq(userOauthAccounts.userId, byEmail.id), eq(userOauthAccounts.provider, PROVIDER)),
          )
          .limit(1);

        if (dejaLie && dejaLie.providerUserId !== profile.subject) {
          throw new SsoExchangeError("ce compte est déjà lié à une autre identité");
        }

        await this.link(byEmail.id, profile);
        await this.refresh(byEmail.id, profile);
        return { id: byEmail.id, created: false };
      }
    }

    if (!profile.email) throw new SsoExchangeError("aucune adresse e-mail dans le profil");

    /**
     * L'adresse appartient déjà à un compte que le rapprochement a écarté.
     *
     * C'est le cas d'une adresse **non vérifiée** par le fournisseur. Créer
     * malgré tout violerait l'unicité de `users.email` et ferait remonter une
     * erreur SQL au navigateur ; laisser passer serait pire encore. Le refus
     * est explicite, et il dit quoi faire.
     */
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${profile.email})`)
      .limit(1);

    if (taken) {
      throw new SsoExchangeError(
        "cette adresse e-mail est déjà employée par un compte, et votre fournisseur " +
          "ne l'a pas déclarée vérifiée",
      );
    }

    const now = new Date().toISOString();
    const [created] = await this.db
      .insert(users)
      .values({
        email: profile.email,
        // Aucun mot de passe local : le compte n'existe que par le
        // fournisseur. Une chaîne vide serait un condensat valide au sens du
        // type et ouvrirait une connexion sans secret.
        passwordHash: null,
        nameFirst: profile.nameFirst,
        nameLast: profile.nameLast,
        // `externalId` n'est **pas** renseigné : cette colonne appartient au
        // système de facturation, qui y pose l'identifiant de son propre
        // client. L'identité du fournisseur va dans `user_oauth_accounts`.
        emailVerifiedAt: profile.emailVerified ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id });

    if (!created) throw new SsoExchangeError("le compte n'a pas pu être créé");
    await this.link(created.id, profile);
    return { id: created.id, created: true };
  }

  /**
   * Rattache l'identité du fournisseur au compte local.
   *
   * L'adresse est recopiée dans la ligne de liaison : elle dit **avec quelle
   * adresse la personne s'est présentée chez le fournisseur**, qui n'est pas
   * forcément celle du compte panel — on peut changer la sienne ici sans la
   * changer là-bas, et savoir laquelle a servi au rapprochement est ce qui
   * permet d'expliquer une liaison surprenante.
   *
   * Idempotent : rejouer une connexion ne doit pas échouer sur l'index unique.
   */
  private async link(userId: string, profile: SsoProfile): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(userOauthAccounts)
      .values({
        userId,
        provider: PROVIDER,
        providerUserId: profile.subject,
        email: profile.email ?? "",
        linkedAt: now,
      })
      .onConflictDoNothing();
  }

  /**
   * Réaligne le compte sur le profil du fournisseur.
   *
   * Le fournisseur est la source de vérité : un nom corrigé chez lui doit se
   * voir ici, et l'inverse n'a pas de sens. Le rôle, lui, n'est jamais touché
   * — il appartient au panel, et le laisser piloter de l'extérieur ferait
   * qu'un fournisseur mal configuré distribuerait des droits d'administration.
   */
  private async refresh(userId: string, profile: SsoProfile): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(users)
      .set({
        // Les noms vides ne sont pas recopiés : un fournisseur qui ne rend pas
        // l'état civil ne doit pas effacer ce qui s'affichait jusque-là.
        ...(profile.nameFirst ? { nameFirst: profile.nameFirst } : {}),
        ...(profile.nameLast ? { nameLast: profile.nameLast } : {}),
        // L'adresse ne bouge que si le fournisseur atteste l'avoir vérifiée :
        // sans cela, il pourrait réécrire un compte sur une adresse qui n'est
        // pas à son titulaire.
        ...(profile.email && profile.emailVerified ? { email: profile.email } : {}),
        // `lastLoginAt` n'est **pas** touché ici : c'est `issueSession` qui le
        // pose, pour toutes les façons d'entrer. Deux écrivains pour la même
        // colonne finiraient par se contredire, et l'un des deux resterait en
        // arrière le jour où un chemin d'entrée est ajouté.
        updatedAt: now,
      })
      .where(eq(users.id, userId));
  }
}
