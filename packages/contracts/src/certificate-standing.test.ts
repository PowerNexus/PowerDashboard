import { describe, expect, it } from "vitest";
import { certificateExpiringSoon, certificateStanding } from "./provisioning";

/**
 * Où en est le certificat d'un domaine de revendeur.
 *
 * L'écran d'administration pose toujours la même question — **les clients de
 * ce revendeur voient-ils un avertissement de sécurité, et si oui pourquoi** —
 * et quatre champs indépendants y répondent ensemble. Les résumer en un seul
 * état est exactement l'endroit où l'on perd un fait.
 */

const JOUR = 24 * 60 * 60 * 1000;
const MAINTENANT = Date.parse("2026-09-20T12:00:00Z");
const dans = (jours: number) => new Date(MAINTENANT + jours * JOUR).toISOString();

const VIERGE = {
  verifiedAt: dans(-30),
  certificateIssuedAt: null,
  certificateExpiresAt: null,
  certificateAttemptedAt: null,
  certificateFailure: null,
};

describe("certificateStanding", () => {
  it("ne demande rien pour un domaine non vérifié", () => {
    // Rien ne prouve encore qu'il appartienne à ce revendeur : demander un
    // certificat pour ce nom serait le demander pour quelqu'un d'autre.
    expect(certificateStanding({ ...VIERGE, verifiedAt: null }, MAINTENANT)).toBe("not_sought");
  });

  it("met en file un domaine vérifié jamais tenté", () => {
    expect(certificateStanding(VIERGE, MAINTENANT)).toBe("queued");
  });

  it("dit « actif » quand le certificat tient", () => {
    expect(
      certificateStanding(
        {
          ...VIERGE,
          certificateIssuedAt: dans(-10),
          certificateExpiresAt: dans(80),
          certificateAttemptedAt: dans(-10),
        },
        MAINTENANT,
      ),
    ).toBe("active");
  });

  it("distingue un renouvellement en échec d'un échec tout court", () => {
    /*
     * Le seul état où tout va bien à l'écran du client et où il faut agir
     * quand même. L'écraser en « actif » ferait rater l'échéance ; l'écraser
     * en « échec » ferait croire à une panne en cours.
     */
    expect(
      certificateStanding(
        {
          ...VIERGE,
          certificateIssuedAt: dans(-60),
          certificateExpiresAt: dans(20),
          certificateAttemptedAt: dans(-1),
          certificateFailure: "Le domaine ne résout plus vers cette machine.",
        },
        MAINTENANT,
      ),
    ).toBe("renewing");

    expect(
      certificateStanding(
        { ...VIERGE, certificateAttemptedAt: dans(-1), certificateFailure: "Limite atteinte." },
        MAINTENANT,
      ),
    ).toBe("failed");
  });

  it("avoue son ignorance plutôt que de trancher", () => {
    // Tenté, sans certificat et sans motif : le compte rendu est incomplet.
    // Choisir entre « ça va » et « c'est cassé » serait inventer.
    expect(certificateStanding({ ...VIERGE, certificateAttemptedAt: dans(-1) }, MAINTENANT)).toBe(
      "unknown",
    );
  });
});

describe("certificateExpiringSoon", () => {
  it("rend null quand l'échéance est inconnue", () => {
    // `null` et non `false` : « je ne sais pas » n'est pas « tout va bien ».
    expect(certificateExpiringSoon(null, MAINTENANT)).toBeNull();
  });

  it("signale une échéance à moins de trente jours", () => {
    expect(certificateExpiringSoon(dans(20), MAINTENANT)).toBe(true);
    expect(certificateExpiringSoon(dans(40), MAINTENANT)).toBe(false);
  });

  it("considère un certificat expiré comme proche de l'échéance", () => {
    // Il l'est même tout à fait : le traiter comme lointain ferait ignorer le
    // cas le plus urgent.
    expect(certificateExpiringSoon(dans(-1), MAINTENANT)).toBe(true);
  });
});
