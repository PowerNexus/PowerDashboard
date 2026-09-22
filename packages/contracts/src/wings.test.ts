import { describe, expect, it } from "vitest";
import {
  parseWingsAuthorization,
  SFTP_INVALID_CREDENTIALS_STATUS,
  SftpAuthRequest,
  WINGS_REMOTE_PREFIX,
  WINGS_REMOTE_ROUTES,
  WingsBackupReport,
  WingsServerListResponse,
  wingsAcceptsStatus,
  wingsWillRetry,
} from "./wings";

describe("parseWingsAuthorization", () => {
  it("sépare l'identifiant du secret", () => {
    expect(parseWingsAuthorization("Bearer abc123.secret-opaque")).toEqual({
      id: "abc123",
      secret: "secret-opaque",
    });
  });

  it("découpe au premier point seulement", () => {
    // Un secret contenant un point resterait intact. Un `split(".")` naïf le
    // tronquerait et ferait échouer une authentification pourtant valide —
    // avec un node qui semble injoignable sans raison visible.
    expect(parseWingsAuthorization("Bearer id.une.cle.avec.des.points")).toEqual({
      id: "id",
      secret: "une.cle.avec.des.points",
    });
  });

  it("tolère la casse du schéma", () => {
    expect(parseWingsAuthorization("bearer abc.def")?.id).toBe("abc");
  });

  it("refuse un autre schéma d'authentification", () => {
    expect(parseWingsAuthorization("Basic abc.def")).toBe(null);
  });

  it("refuse un jeton sans séparateur", () => {
    expect(parseWingsAuthorization("Bearer jetonentier")).toBe(null);
  });

  it("refuse un identifiant ou un secret vide", () => {
    expect(parseWingsAuthorization("Bearer .secret")).toBe(null);
    expect(parseWingsAuthorization("Bearer identifiant.")).toBe(null);
  });

  it("refuse une valeur absente", () => {
    expect(parseWingsAuthorization(null)).toBe(null);
    expect(parseWingsAuthorization("")).toBe(null);
    expect(parseWingsAuthorization("Bearer")).toBe(null);
  });
});

describe("wingsWillRetry", () => {
  it("n'insiste pas sur une erreur du client", () => {
    expect(wingsWillRetry(400)).toBe(false);
    expect(wingsWillRetry(404)).toBe(false);
    expect(wingsWillRetry(422)).toBe(false);
  });

  it("réessaie sur une erreur du serveur", () => {
    // Le piège : répondre 500 pour une condition définitive — un serveur
    // supprimé — déclenche une boucle de tentatives avec temporisation.
    expect(wingsWillRetry(500)).toBe(true);
    expect(wingsWillRetry(503)).toBe(true);
  });
});

describe("wingsAcceptsStatus", () => {
  it("accepte les réponses 2xx", () => {
    expect(wingsAcceptsStatus(200)).toBe(true);
    expect(wingsAcceptsStatus(204)).toBe(true);
  });

  it("refuse une redirection", () => {
    // Cas réel à prévoir : un intergiciel d'authentification appliqué par
    // erreur aux routes « remote » renverrait une 302 vers /login. Wings la
    // traite comme une panne, pas comme une redirection à suivre.
    expect(wingsAcceptsStatus(302)).toBe(false);
  });

  it("refuse les erreurs", () => {
    expect(wingsAcceptsStatus(403)).toBe(false);
    expect(wingsAcceptsStatus(500)).toBe(false);
  });
});

describe("refus d'identifiants SFTP", () => {
  it("emploie un code que Wings interprète comme un refus", () => {
    // Wings ne distingue pas les 4xx entre eux pour cet appel : tout code de
    // cette plage signifie « identifiants invalides ».
    expect(wingsWillRetry(SFTP_INVALID_CREDENTIALS_STATUS)).toBe(false);
    expect(SFTP_INVALID_CREDENTIALS_STATUS).toBeGreaterThanOrEqual(400);
    expect(SFTP_INVALID_CREDENTIALS_STATUS).toBeLessThan(500);
  });
});

describe("routes relevées dans la source du daemon", () => {
  it("emploie un préfixe sans numéro de version", () => {
    // Wings construit son URL de base lui-même : nous ne pouvons pas y
    // appliquer la convention /api/v1 des routes du panel.
    expect(WINGS_REMOTE_PREFIX).toBe("/api/remote");
    expect(WINGS_REMOTE_PREFIX).not.toContain("v1");
  });

  it("couvre les appels faciles à oublier", () => {
    const paths = WINGS_REMOTE_ROUTES.map((r) => `${r.method} ${r.path}`);
    // Trois absences qui ne se voient qu'à l'usage : la remise à zéro au
    // démarrage du daemon, le journal d'activité, et les sauvegardes qui
    // vivent sous /backups et non sous le serveur.
    expect(paths).toContain("POST /servers/reset");
    expect(paths).toContain("POST /activity");
    expect(paths).toContain("POST /backups/{uuid}");
  });

  it("place les sauvegardes hors de l'arborescence des serveurs", () => {
    const backups = WINGS_REMOTE_ROUTES.filter((r) => r.path.includes("backup"));
    expect(backups.length).toBeGreaterThan(0);
    for (const route of backups) {
      expect(route.path.startsWith("/backups")).toBe(true);
    }
  });
});

describe("formes imposées", () => {
  it("accepte l'inventaire paginé tel que Wings le désérialise", () => {
    const payload = {
      data: [
        {
          uuid: "8d93a926-9f17-4d9a-8b5a-3a5f8b9e0001",
          settings: { name: "survival" },
          process_configuration: { startup: {} },
        },
      ],
      meta: { current_page: 1, from: 1, last_page: 1, per_page: 50, to: 1, total: 1 },
    };
    expect(WingsServerListResponse.safeParse(payload).success).toBe(true);
  });

  it("refuse une pagination incomplète", () => {
    // Wings lit `meta` sans tolérance : un champ manquant produit un zéro
    // silencieux et une pagination qui s'arrête à la première page.
    const payload = { data: [], meta: { current_page: 1 } };
    expect(WingsServerListResponse.safeParse(payload).success).toBe(false);
  });

  it("n'accepte que les deux modes d'authentification SFTP du daemon", () => {
    const base = { username: "u", password: "p", ip: "10.0.0.1" };
    expect(SftpAuthRequest.safeParse({ ...base, type: "password" }).success).toBe(true);
    expect(SftpAuthRequest.safeParse({ ...base, type: "public_key" }).success).toBe(true);
    expect(SftpAuthRequest.safeParse({ ...base, type: "keyboard-interactive" }).success).toBe(
      false,
    );
  });
});

/**
 * Le compte rendu de sauvegarde, tel que le daemon l'envoie vraiment.
 *
 * Relevé en faisant tourner un vrai Wings : il fabriquait l'archive, puis se
 * voyait répondre « Compte rendu de sauvegarde invalide ». Toute sauvegarde
 * locale restait « en cours » pour toujours — quota consommé, téléchargement
 * refusé, restauration impossible, suppression impossible.
 *
 * La cause tenait en un mot : Go sérialise une tranche nil en `null`, et le
 * daemon ne remplit `parts` que pour un dépôt sur compartiment.
 */
describe("compte rendu de sauvegarde", () => {
  const local = {
    checksum: "7f2b1c4e9a",
    checksum_type: "sha1",
    size: 4096,
    successful: true,
    // Exactement ce que le daemon envoie pour une sauvegarde sur disque.
    parts: null,
  };

  it("accepte `parts: null` — c'est le cas d'une sauvegarde locale", () => {
    const lu = WingsBackupReport.parse(local);
    expect(lu.parts).toEqual([]);
  });

  it("accepte un envoi multipart, et garde ses morceaux", () => {
    const lu = WingsBackupReport.parse({
      ...local,
      parts: [{ etag: "abc", part_number: 1 }],
    });
    expect(lu.parts).toEqual([{ etag: "abc", part_number: 1 }]);
  });

  it("accepte l'absence du champ", () => {
    // Le daemon d'une version antérieure peut ne rien envoyer du tout.
    const { parts: _, ...sans } = local;
    expect(WingsBackupReport.parse(sans).parts).toEqual([]);
  });

  it("refuse toujours un morceau mal formé", () => {
    // La tolérance porte sur l'absence, pas sur le contenu : un numéro de
    // partie à zéro ferait échouer l'assemblage côté compartiment.
    expect(
      WingsBackupReport.safeParse({ ...local, parts: [{ etag: "abc", part_number: 0 }] }).success,
    ).toBe(false);
  });

  it("survit au passage par `partial()`, comme la route l'emploie", () => {
    // La route accepte un compte rendu incomplet : des daemons n'envoient
    // rien. Le champ toléré ne doit pas redevenir strict au passage.
    const lu = WingsBackupReport.partial().parse({ successful: true, parts: null });
    expect(lu.parts).toEqual([]);
  });
});
