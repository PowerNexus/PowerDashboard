import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import { beforeEach, describe, expect, it } from "vitest";
import { SoftwareAuthenticator } from "./passkey.authenticator";
import type { PasskeyRepository, StoredPasskey } from "./passkey.repository";
import { PasskeyService, type RelyingParty } from "./passkey.service";

const RP: RelyingParty = {
  name: "GameDashboard",
  id: "localhost",
  origin: "http://localhost:3000",
  scope: null,
};
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.fr", name: "Alex B" };

/**
 * Dépôt en mémoire.
 *
 * Seul le stockage est simulé. La vérification — CBOR, COSE, signature — est
 * bien celle de `@simplewebauthn/server`, exercée par de vraies réponses d'un
 * authentifiant logiciel. C'est la seule façon d'éprouver ce code sans
 * simplement se donner raison.
 */
function repository() {
  const rows: (StoredPasskey & { userId: string; label: string; rpId: string | null })[] = [];
  // Même règle que `inScope` du vrai dépôt : `null` désigne la plateforme.
  const inScope = (row: { rpId: string | null }, scope: string | null) =>
    (row.rpId ?? null) === scope;
  return {
    rows,
    repo: {
      credentialsForUser: async (userId: string, scope: string | null) =>
        rows.filter((r) => r.userId === userId && inScope(r, scope)),
      findCredential: async (userId: string, credentialId: string, scope: string | null) =>
        rows.find(
          (r) => r.userId === userId && r.credentialId === credentialId && inScope(r, scope),
        ) ?? null,
      add: async (input: Record<string, unknown>) => {
        rows.push({ id: `row-${rows.length}`, ...input } as never);
      },
      recordUse: async (id: string, counter: number) => {
        const row = rows.find((r) => r.id === id);
        if (row) row.counter = counter;
      },
    } as unknown as PasskeyRepository,
  };
}

describe("PasskeyService", () => {
  let store: ReturnType<typeof repository>;
  let service: PasskeyService;
  let authenticator: SoftwareAuthenticator;

  beforeEach(() => {
    store = repository();
    service = new PasskeyService(store.repo);
    authenticator = new SoftwareAuthenticator({ rpId: RP.id, origin: RP.origin });
  });

  describe("enregistrement", () => {
    it("accepte une réponse authentique et range la clé", async () => {
      const options = await service.registrationOptions(RP, USER);
      const response = authenticator.register(options.challenge);

      expect(
        await service.verifyRegistration(
          RP,
          USER.id,
          options.challenge,
          response as never,
          "Ma clé",
        ),
      ).toBe(true);
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]?.label).toBe("Ma clé");
    });

    it("refuse un défi qui n'est pas celui qu'on attendait", async () => {
      // Le cœur de la protection contre le rejeu : une réponse capturée sur une
      // cérémonie antérieure ne doit pas resservir.
      const options = await service.registrationOptions(RP, USER);
      const response = authenticator.register(options.challenge);
      const other = await generateRegistrationOptions({
        rpName: RP.name,
        rpID: RP.id,
        userName: USER.email,
      });

      expect(
        await service.verifyRegistration(RP, USER.id, other.challenge, response as never, "x"),
      ).toBe(false);
      expect(store.rows).toHaveLength(0);
    });

    /**
     * La protection contre l'hameçonnage, et la raison pour laquelle `rpID` ne
     * doit jamais venir de la requête : une cérémonie menée sur un autre
     * domaine produit un `rpIdHash` différent, que la vérification rejette.
     */
    it("refuse une cérémonie menée sur un autre domaine", async () => {
      const attacker = new SoftwareAuthenticator({
        rpId: "evil.example",
        origin: "https://evil.example",
      });
      const options = await service.registrationOptions(RP, USER);

      expect(
        await service.verifyRegistration(
          RP,
          USER.id,
          options.challenge,
          attacker.register(options.challenge) as never,
          "x",
        ),
      ).toBe(false);
    });

    it("refuse une réponse informe sans lever d'exception", async () => {
      const options = await service.registrationOptions(RP, USER);
      for (const bad of [{}, { id: "x" }, { response: {} }]) {
        expect(
          await service.verifyRegistration(RP, USER.id, options.challenge, bad as never, "x"),
        ).toBe(false);
      }
    });

    it("écarte les clés déjà enregistrées de la prochaine cérémonie", async () => {
      // Sans `excludeCredentials`, le même objet accepterait d'être enregistré
      // deux fois et laisserait deux lignes indiscernables dans la liste.
      const first = await service.registrationOptions(RP, USER);
      await service.verifyRegistration(
        RP,
        USER.id,
        first.challenge,
        authenticator.register(first.challenge) as never,
        "x",
      );

      const second = await service.registrationOptions(RP, USER);
      expect(second.excludeCredentials?.map((c) => c.id)).toEqual([
        authenticator.credentialId.toString("base64url"),
      ]);
    });
  });

  describe("authentification", () => {
    async function enrolled() {
      const options = await service.registrationOptions(RP, USER);
      await service.verifyRegistration(
        RP,
        USER.id,
        options.challenge,
        authenticator.register(options.challenge) as never,
        "Ma clé",
      );
    }

    it("accepte une assertion authentique", async () => {
      await enrolled();
      const options = await service.authenticationOptions(RP, USER.id);

      expect(
        await service.verifyAuthentication(
          RP,
          USER.id,
          options.challenge,
          authenticator.authenticate(options.challenge) as never,
        ),
      ).toBe(true);
    });

    it("remonte le compteur, garde-fou anti-clonage", async () => {
      await enrolled();
      const options = await service.authenticationOptions(RP, USER.id);
      await service.verifyAuthentication(
        RP,
        USER.id,
        options.challenge,
        authenticator.authenticate(options.challenge, { counter: 42 }) as never,
      );

      expect(store.rows[0]?.counter).toBe(42);
    });

    it("refuse une assertion pour un défi périmé", async () => {
      await enrolled();
      const options = await service.authenticationOptions(RP, USER.id);
      const stale = authenticator.authenticate(options.challenge);
      const fresh = await generateAuthenticationOptions({ rpID: RP.id });

      expect(await service.verifyAuthentication(RP, USER.id, fresh.challenge, stale as never)).toBe(
        false,
      );
    });

    /**
     * Le contrôle qui empêche d'ouvrir le mauvais compte : la clé est cherchée
     * parmi celles du compte nommé par le défi, pas dans toute la table.
     */
    it("refuse la clé de quelqu'un d'autre", async () => {
      await enrolled();
      const options = await service.authenticationOptions(RP, USER.id);

      expect(
        await service.verifyAuthentication(
          RP,
          "22222222-2222-4222-8222-222222222222",
          options.challenge,
          authenticator.authenticate(options.challenge) as never,
        ),
      ).toBe(false);
    });

    it("refuse une assertion signée par une autre clé", async () => {
      await enrolled();
      const impostor = new SoftwareAuthenticator({ rpId: RP.id, origin: RP.origin });
      const options = await service.authenticationOptions(RP, USER.id);

      // L'imposteur se présente sous l'identifiant de la vraie clé, mais signe
      // avec la sienne : c'est la signature qui tranche, pas l'identifiant.
      const forged = impostor.authenticate(options.challenge);
      forged.id = authenticator.credentialId.toString("base64url");

      expect(
        await service.verifyAuthentication(RP, USER.id, options.challenge, forged as never),
      ).toBe(false);
    });

    it("refuse une assertion obtenue sur un autre domaine", async () => {
      await enrolled();
      const options = await service.authenticationOptions(RP, USER.id);
      const phished = new SoftwareAuthenticator({
        rpId: "evil.example",
        origin: "https://evil.example",
      });
      const forged = phished.authenticate(options.challenge);
      forged.id = authenticator.credentialId.toString("base64url");

      expect(
        await service.verifyAuthentication(RP, USER.id, options.challenge, forged as never),
      ).toBe(false);
    });

    it("désigne la clé du compte dans les options", async () => {
      await enrolled();
      const options = await service.authenticationOptions(RP, USER.id);
      expect(options.allowCredentials?.map((c) => c.id)).toEqual([
        authenticator.credentialId.toString("base64url"),
      ]);
    });
  });

  /**
   * Clés d'accès sur le domaine d'un revendeur.
   *
   * Le domaine relais était toujours celui de `PANEL_ORIGIN` : sur
   * `panel.revendeur.fr`, le navigateur refusait toute cérémonie, et les
   * clients d'un revendeur ne pouvaient pas utiliser de clé d'accès.
   */
  describe("domaine d'un revendeur", () => {
    const REVENDEUR: RelyingParty = {
      name: "Revendeur",
      id: "panel.revendeur.fr",
      origin: "https://panel.revendeur.fr",
      scope: "panel.revendeur.fr",
    };

    it("enregistre sur le domaine du revendeur, et range la clé dans sa portée", async () => {
      const cle = new SoftwareAuthenticator({ rpId: REVENDEUR.id, origin: REVENDEUR.origin });
      const options = await service.registrationOptions(REVENDEUR, USER);

      expect(options.rp.id).toBe("panel.revendeur.fr");
      expect(
        await service.verifyRegistration(
          REVENDEUR,
          USER.id,
          options.challenge,
          cle.register(options.challenge) as never,
          "Clé revendeur",
        ),
      ).toBe(true);
      expect(store.rows[0]?.rpId).toBe("panel.revendeur.fr");
    });

    it("ne propose ni n'accepte une clé hors du domaine où elle a été créée", async () => {
      const cle = new SoftwareAuthenticator({ rpId: REVENDEUR.id, origin: REVENDEUR.origin });
      const inscription = await service.registrationOptions(REVENDEUR, USER);
      await service.verifyRegistration(
        REVENDEUR,
        USER.id,
        inscription.challenge,
        cle.register(inscription.challenge) as never,
        "Clé revendeur",
      );

      // Sur la plateforme, la clé du revendeur n'est ni proposée ni vérifiée.
      const surPlateforme = await service.authenticationOptions(RP, USER.id);
      expect(surPlateforme.allowCredentials).toEqual([]);
      expect(
        await service.verifyAuthentication(
          RP,
          USER.id,
          surPlateforme.challenge,
          cle.authenticate(surPlateforme.challenge) as never,
        ),
      ).toBe(false);

      // Sur son domaine, elle ouvre la session.
      const chezLui = await service.authenticationOptions(REVENDEUR, USER.id);
      expect(chezLui.allowCredentials).toHaveLength(1);
      expect(
        await service.verifyAuthentication(
          REVENDEUR,
          USER.id,
          chezLui.challenge,
          cle.authenticate(chezLui.challenge) as never,
        ),
      ).toBe(true);
    });
  });
});
