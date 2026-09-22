import type { SsoProfile } from "@gamedashboard/contracts";
import type { Database } from "@gamedashboard/db";
import { describe, expect, it, vi } from "vitest";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import { SsoExchangeError, SsoService } from "./sso.service";

/**
 * Qui hérite de quel compte, à la sortie d'une cérémonie SSO.
 *
 * C'est la question la plus lourde du module : une réponse trop généreuse
 * remet à un inconnu les serveurs, les sauvegardes et les bases de données de
 * quelqu'un d'autre. Le service la traitait correctement et **sans aucun
 * test** — puis la règle a été réécrite pour sortir l'identité de
 * `users.external_id`, que la facturation revendique.
 *
 * Les quatre cas ci-dessous sont les seuls qui comptent. Le cinquième — la
 * création d'un compte neuf — se voit à l'écran dès la première connexion ; les
 * quatre autres ne se voient jamais tant qu'ils fonctionnent.
 */

const COMPTE = "11111111-1111-1111-1111-111111111111";
const AUTRE = "22222222-2222-2222-2222-222222222222";

function profil(surcharge: Partial<SsoProfile> = {}): SsoProfile {
  return {
    subject: "sub-du-fournisseur",
    email: "paul@exemple.fr",
    emailVerified: true,
    nameFirst: "Paul",
    nameLast: "Martin",
    ...surcharge,
  } as SsoProfile;
}

/**
 * Base simulée : chaque lecture rend ce que le scénario lui dicte, dans
 * l'ordre où `resolveUser` les enchaîne — liaison par identité, compte par
 * adresse, liaison de ce compte.
 */
function service(scenario: {
  liaisonParIdentite?: { id: string } | null;
  compteParAdresse?: { id: string } | null;
  liaisonDuCompte?: { providerUserId: string } | null;
}) {
  let lecture = 0;
  const inserts: unknown[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            lecture += 1;
            if (lecture === 1)
              return scenario.liaisonParIdentite ? [scenario.liaisonParIdentite] : [];
            if (lecture === 2) return scenario.compteParAdresse ? [scenario.compteParAdresse] : [];
            return scenario.liaisonDuCompte ? [scenario.liaisonDuCompte] : [];
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({
      values: (v: unknown) => {
        inserts.push(v);
        return {
          onConflictDoNothing: async () => undefined,
          returning: async () => [{ id: "compte-cree" }],
        };
      },
    }),
  } as unknown as Database;

  const svc = new SsoService(db, {
    ssoConfiguration: vi.fn(async () => null),
  } as unknown as PlatformSettingsService);

  return { svc, inserts };
}

describe("rapprochement SSO", () => {
  it("reconnaît une identité déjà liée", async () => {
    const { svc } = service({ liaisonParIdentite: { id: COMPTE } });

    await expect(svc.resolveUser(profil())).resolves.toEqual({ id: COMPTE, created: false });
  });

  it("rapproche par adresse quand le fournisseur l'a vérifiée", async () => {
    const { svc, inserts } = service({
      liaisonParIdentite: null,
      compteParAdresse: { id: COMPTE },
      liaisonDuCompte: null,
    });

    await expect(svc.resolveUser(profil())).resolves.toEqual({ id: COMPTE, created: false });
    // La liaison est écrite : sans elle, la connexion suivante repasserait par
    // le rapprochement d'adresse, qui est le chemin le moins sûr des deux.
    expect(inserts).toHaveLength(1);
  });

  it("refuse de rapprocher sur une adresse non vérifiée", async () => {
    /*
     * Le cœur de l'affaire. Quiconque déclare chez un fournisseur laxiste
     * l'adresse de quelqu'un d'autre hériterait sinon de son compte, de ses
     * serveurs et de ses sauvegardes.
     *
     * Le service ne doit pas non plus créer un second compte sur cette
     * adresse : l'unicité l'interdit, et l'erreur SQL remonterait au
     * navigateur. Il refuse en disant pourquoi.
     */
    const { svc } = service({
      liaisonParIdentite: null,
      // Le rapprochement est sauté faute de vérification ; la lecture suivante
      // est celle qui constate que l'adresse est déjà prise.
      compteParAdresse: { id: COMPTE },
    });

    await expect(svc.resolveUser(profil({ emailVerified: false }))).rejects.toBeInstanceOf(
      SsoExchangeError,
    );
  });

  it("refuse de détourner un compte déjà lié à une autre identité", async () => {
    // Même adresse, autre `sub` : deux personnes distinctes chez le
    // fournisseur, ou un `sub` réattribué. Dans les deux cas, rapprocher
    // donnerait le compte du premier au second.
    const { svc } = service({
      liaisonParIdentite: null,
      compteParAdresse: { id: COMPTE },
      liaisonDuCompte: { providerUserId: AUTRE },
    });

    await expect(svc.resolveUser(profil())).rejects.toBeInstanceOf(SsoExchangeError);
  });

  it("refuse un profil sans adresse", async () => {
    // Sans adresse, ni rapprochement ni création : un compte sans e-mail ne
    // peut ni récupérer son accès ni recevoir un avis.
    const { svc } = service({ liaisonParIdentite: null });

    await expect(svc.resolveUser(profil({ email: null }))).rejects.toBeInstanceOf(SsoExchangeError);
  });
});
