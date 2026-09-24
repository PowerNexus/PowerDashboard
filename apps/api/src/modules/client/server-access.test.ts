import type { Database } from "@gamedashboard/db";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Denial, DenialLogService } from "../activity/denial-log.service";
import { ServerAccessService } from "./server-access.service";

/** Le journal des refus, muet : la plupart de ces tests portent sur la décision. */
const silence = { record: async () => {} } as unknown as DenialLogService;

const SERVER = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";
const SUBUSER = "33333333-3333-3333-3333-333333333333";

/**
 * Base simulée, dans l'ordre réel des requêtes du service :
 *
 * 1. « le serveur est-il à moi ? »
 * 2. « suis-je sous-utilisateur ? »
 * 3. « quel est mon rôle ? » — seulement si ni l'un ni l'autre
 * 4. « que le revendeur de ce serveur accorde-t-il à la plateforme ? »
 *
 * La quatrième est venue avec les trois niveaux d'accès. Sans elle, le
 * personnel avait tous les droits partout : un revendeur pouvait refuser qu'on
 * *crée* chez lui, et gardait malgré tout un administrateur capable d'ouvrir
 * la console de chacun de ses clients.
 *
 * `platformAccess` absent vaut « pas de revendeur » : le serveur est à la
 * plateforme, qui ne se limite pas elle-même.
 */
function service(
  rows: {
    owned: boolean;
    subuser?: { preset: string | null; permissions: string[] };
    role?: string;
    platformAccess?: "provision" | "read_only" | "none";
  },
  denials: DenialLogService = silence,
) {
  let call = 0;
  const repondre = async () => {
    call += 1;
    if (call === 1) return rows.owned ? [{ id: SERVER }] : [];
    if (call === 2) return rows.subuser ? [rows.subuser] : [];
    if (call === 3) return rows.role ? [{ role: rows.role }] : [{ role: "user" }];
    // Le niveau du revendeur. Aucune ligne = aucun revendeur sur ce serveur.
    return rows.platformAccess ? [{ niveau: rows.platformAccess }] : [];
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: repondre }),
        // La lecture du niveau joint `users` au serveur : même réponse, une
        // étape de plus dans la chaîne.
        innerJoin: () => ({ where: () => ({ limit: repondre }) }),
      }),
    }),
  } as unknown as Database;

  return new ServerAccessService(db, denials);
}

describe("portées d'une clé d'API", () => {
  it("refuse une permission hors portée, même au propriétaire", async () => {
    // C'est tout l'intérêt des portées : une clé pour un bot qui redémarre ne
    // doit pas pouvoir effacer les fichiers, alors que son propriétaire, lui,
    // le peut parfaitement depuis le panel.
    const svc = service({ owned: true });

    await expect(
      svc.require({ id: OWNER, scopes: ["power.restart"] }, SERVER, "files.delete"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("accepte une permission dans la portée", async () => {
    const svc = service({ owned: true });
    await expect(
      svc.require({ id: OWNER, scopes: ["power.restart"] }, SERVER, "power.restart"),
    ).resolves.toEqual({ isOwner: true });
  });

  it("refuse tout à une clé sans portée", async () => {
    // « Aucune portée » et « aucune restriction » ne doivent jamais se
    // confondre : la liste vide est la plus restrictive, pas la plus large.
    const svc = service({ owned: true });
    await expect(
      svc.require({ id: OWNER, scopes: [] }, SERVER, "console.read"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("ne restreint rien pour une session de navigateur", async () => {
    const svc = service({ owned: true });
    await expect(svc.require({ id: OWNER, scopes: null }, SERVER, "files.delete")).resolves.toEqual(
      { isOwner: true },
    );
  });

  it("borne aussi un sous-utilisateur, sans élargir ses droits", async () => {
    // La portée plafonne, elle n'accorde pas : une clé qui demande
    // « files.delete » ne le donne pas à qui ne l'a pas.
    const svc = service({
      owned: false,
      subuser: { preset: null, permissions: ["console.read"] },
    });

    await expect(
      svc.require({ id: SUBUSER, scopes: ["files.delete"] }, SERVER, "files.delete"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("accès sans portée", () => {
  it("laisse passer le propriétaire", async () => {
    const svc = service({ owned: true });
    await expect(svc.require({ id: OWNER, scopes: null }, SERVER, "power.kill")).resolves.toEqual({
      isOwner: true,
    });
  });

  it("répond « introuvable » à un inconnu, pour ne pas révéler l'existence du serveur", async () => {
    const svc = service({ owned: false });
    await expect(
      svc.require({ id: SUBUSER, scopes: null }, SERVER, "console.read"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("répond « interdit » à un sous-utilisateur qui a accès mais pas la permission", async () => {
    // La distinction est légitime ici : il sait déjà que le serveur existe.
    const svc = service({
      owned: false,
      subuser: { preset: null, permissions: ["console.read"] },
    });
    await expect(
      svc.require({ id: SUBUSER, scopes: null }, SERVER, "power.kill"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/**
 * Refus consignés (NC-12).
 *
 * Un compte qui essayait les identifiants de serveur un à un, ou un
 * sous-utilisateur qui forçait une action retirée, ne laissait rien au
 * journal. La réponse, elle, ne change pas : un 404 d'inconnu reste un 404.
 */
describe("refus consignés", () => {
  function journal() {
    const refus: Denial[] = [];
    const denials = {
      record: vi.fn(async (denial: Denial) => {
        refus.push(denial);
      }),
    } as unknown as DenialLogService;
    return { denials, refus };
  }

  const origin = { ip: "203.0.113.30", route: "POST /api/v1/client/servers/:id/power" };

  it("consigne l'inconnu, sans rien changer à son 404", async () => {
    const { denials, refus } = journal();
    const svc = service({ owned: false }, denials);

    await expect(
      svc.require({ id: SUBUSER, scopes: null, origin }, SERVER, "power.start"),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(refus).toEqual([
      {
        event: "access.denied",
        actorId: SUBUSER,
        actorType: "user",
        origin,
        properties: { server: SERVER, permission: "power.start", status: 404 },
      },
    ]);
  });

  it("consigne la permission refusée à un sous-utilisateur", async () => {
    const { denials, refus } = journal();
    const svc = service({ owned: false, subuser: { preset: null, permissions: [] } }, denials);

    await expect(
      svc.require({ id: SUBUSER, scopes: null, origin }, SERVER, "files.delete"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(refus[0]?.properties).toEqual({
      server: SERVER,
      permission: "files.delete",
      status: 403,
    });
  });

  it("consigne la portée refusée à une clé d'API, comme un refus de la clé", async () => {
    const { denials, refus } = journal();
    const svc = service({ owned: true }, denials);

    await expect(
      svc.require({ id: OWNER, scopes: ["console.read"] }, SERVER, "files.delete"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(refus[0]).toMatchObject({ actorId: OWNER, actorType: "api_key" });
  });

  it("ne consigne rien pour un accès accordé", async () => {
    const { denials, refus } = journal();
    await service({ owned: true }, denials).require(
      { id: OWNER, scopes: null, origin },
      SERVER,
      "power.kill",
    );
    expect(refus).toEqual([]);
  });
});

describe("message de refus", () => {
  it("nomme la portée manquante", async () => {
    // Un message générique obligerait l'auteur d'un script à deviner laquelle
    // des trente-neuf portées lui manque.
    const svc = service({ owned: true });
    await expect(
      svc.require({ id: OWNER, scopes: ["console.read"] }, SERVER, "files.delete"),
    ).rejects.toThrow(/files\.delete/);
  });
});

/**
 * Relevé en exploitation : un administrateur qui ouvrait la console d'un
 * serveur client se voyait répondre « Serveur introuvable ». C'est la bonne
 * réponse pour un inconnu, et une contradiction pour quelqu'un qui peut tout
 * changer de ce serveur depuis l'administration.
 */
describe("accès du personnel de la plateforme", () => {
  const STAFF = "44444444-4444-4444-4444-444444444444";

  it("donne tout à un administrateur, comme au propriétaire", async () => {
    const svc = service({ owned: false, role: "admin" });
    await expect(svc.require({ id: STAFF, scopes: null }, SERVER, "console.read")).resolves.toEqual(
      {
        isOwner: true,
      },
    );
    // `isOwner` décide si le jeton de console porte `*` : un administrateur qui
    // ne pourrait pas envoyer de commande ne pourrait pas diagnostiquer.
    const svc2 = service({ owned: false, role: "admin" });
    await expect(
      svc2.require({ id: STAFF, scopes: null }, SERVER, "files.delete"),
    ).resolves.toEqual({ isOwner: true });
  });

  it("laisse l'assistance regarder, sans agir", async () => {
    const lecture = service({ owned: false, role: "support" });
    await expect(
      lecture.require({ id: STAFF, scopes: null }, SERVER, "console.read"),
    ).resolves.toEqual({ isOwner: false });

    // `console.send` est volontairement exclu : envoyer une commande dans une
    // console de jeu, c'est agir sur le serveur, pas l'observer.
    const ecriture = service({ owned: false, role: "support" });
    await expect(
      ecriture.require({ id: STAFF, scopes: null }, SERVER, "console.send"),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const suppression = service({ owned: false, role: "support" });
    await expect(
      suppression.require({ id: STAFF, scopes: null }, SERVER, "files.delete"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("ne dit toujours rien à un inconnu", async () => {
    // La discrétion vaut pour tout le monde sauf le personnel : sans elle, on
    // pourrait énumérer les serveurs des autres.
    const svc = service({ owned: false, role: "user" });
    await expect(
      svc.require({ id: STAFF, scopes: null }, SERVER, "console.read"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("ne laisse pas une clé d'API contourner la borne par le rôle", async () => {
    // Les portées sont vérifiées avant tout le reste : un administrateur reste
    // borné par la clé qu'il emploie.
    const svc = service({ owned: false, role: "admin" });
    await expect(
      svc.require({ id: STAFF, scopes: ["console.read"] }, SERVER, "files.delete"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("ce que le revendeur accorde à la plateforme", () => {
  /*
   * Le revendeur répond de ses machines devant ses clients. C'est donc à lui
   * de dire ce que l'hébergeur de l'hébergeur peut en faire — et le réglage
   * précédent ne tenait qu'une des trois portes : il refusait la création, et
   * laissait la console, les fichiers et la suppression.
   */

  it("donne tout à l'administration quand le revendeur l'accorde", async () => {
    const svc = service({ owned: false, role: "admin", platformAccess: "provision" });
    await expect(svc.require({ id: OWNER, scopes: null }, SERVER, "files.delete")).resolves.toEqual(
      { isOwner: true },
    );
  });

  it("réduit l'administration à la lecture quand il ne l'accorde pas", async () => {
    // Elle voit — c'est le sens de « lecture seule » — mais n'écrit pas.
    const lecture = service({ owned: false, role: "admin", platformAccess: "read_only" });
    await expect(
      lecture.require({ id: OWNER, scopes: null }, SERVER, "console.read"),
    ).resolves.toEqual({ isOwner: false });

    const ecriture = service({ owned: false, role: "admin", platformAccess: "read_only" });
    await expect(
      ecriture.require({ id: OWNER, scopes: null }, SERVER, "files.delete"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rend le serveur introuvable quand il refuse toute visibilité", async () => {
    /*
     * « Introuvable » et non « interdit » : la distinction apprendrait qu'il
     * existe un serveur ici, ce qui est déjà plus que rien.
     */
    const svc = service({ owned: false, role: "admin", platformAccess: "none" });
    await expect(
      svc.require({ id: OWNER, scopes: null }, SERVER, "console.read"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("applique la même règle à l'assistance", async () => {
    // L'assistance était déjà en lecture seule ; ce qui change, c'est qu'un
    // revendeur peut désormais lui retirer jusqu'à la vue.
    const svc = service({ owned: false, role: "support", platformAccess: "none" });
    await expect(
      svc.require({ id: OWNER, scopes: null }, SERVER, "console.read"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("ne limite pas la plateforme sur ses propres serveurs", async () => {
    // Aucun revendeur sur ce serveur : il est à la plateforme, et rien ne
    // justifierait qu'elle s'interdise quoi que ce soit chez elle.
    const svc = service({ owned: false, role: "admin" });
    await expect(svc.require({ id: OWNER, scopes: null }, SERVER, "files.delete")).resolves.toEqual(
      { isOwner: true },
    );
  });
});
