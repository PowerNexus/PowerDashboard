import { describe, expect, it } from "vitest";
import { NODE_HEARTBEAT_LOST_MS } from "./node";
import { componentStateOf, INCIDENT_IMPACTS, isIncidentOpen, platformState } from "./status";

const NOW = new Date("2026-03-01T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("componentStateOf", () => {
  const base = { lostAfterMs: NODE_HEARTBEAT_LOST_MS, now: NOW };

  it("annonce opérationnel un node qui vient de parler", () => {
    expect(componentStateOf({ ...base, maintenance: false, lastHeartbeatAt: ago(5_000) })).toBe(
      "operational",
    );
  });

  it("annonce hors service un node muet au-delà du seuil", () => {
    expect(
      componentStateOf({
        ...base,
        maintenance: false,
        lastHeartbeatAt: ago(NODE_HEARTBEAT_LOST_MS * 2),
      }),
    ).toBe("down");
  });

  it("annonce hors service un node jamais joint", () => {
    // Une machine déclarée dont le daemon n'a jamais parlé n'héberge rien :
    // l'annoncer « opérationnelle » serait faux pour qui lit la page.
    expect(componentStateOf({ ...base, maintenance: false, lastHeartbeatAt: null })).toBe("down");
  });

  it("annonce la maintenance quand le node répond encore", () => {
    expect(componentStateOf({ ...base, maintenance: true, lastHeartbeatAt: ago(5_000) })).toBe(
      "maintenance",
    );
  });

  it("préfère la panne à la maintenance quand le node s'est tu", () => {
    // Le fait l'emporte sur l'intention : sans cette règle, il suffirait de
    // cocher « maintenance » pour maquiller une panne.
    expect(
      componentStateOf({
        ...base,
        maintenance: true,
        lastHeartbeatAt: ago(NODE_HEARTBEAT_LOST_MS * 2),
      }),
    ).toBe("down");
  });
});

describe("platformState", () => {
  it("annonce opérationnel quand rien ne cloche", () => {
    expect(platformState({ components: ["operational", "operational"], openIncidents: [] })).toBe(
      "operational",
    );
  });

  it("retient le pire composant, jamais la moyenne", () => {
    // Une plateforme dont un node sur dix est à terre n'est pas
    // « opérationnelle à 90 % » pour le client qui est dessus.
    expect(
      platformState({
        components: ["operational", "operational", "operational", "down"],
        openIncidents: [],
      }),
    ).toBe("down");
  });

  it("distingue une maintenance annoncée d'une dégradation", () => {
    expect(platformState({ components: ["operational", "maintenance"], openIncidents: [] })).toBe(
      "maintenance",
    );
  });

  it("laisse un incident rédigé aggraver l'état", () => {
    expect(platformState({ components: ["operational"], openIncidents: ["critical"] })).toBe(
      "down",
    );
    expect(platformState({ components: ["operational"], openIncidents: ["minor"] })).toBe(
      "degraded",
    );
  });

  it("ne laisse jamais un incident améliorer l'état observé", () => {
    // Le point qui empêche la page de mentir : aucune rédaction ne peut
    // afficher « tout va bien » sur un parc dont un node est muet.
    expect(platformState({ components: ["down"], openIncidents: ["none"] })).toBe("down");
    expect(platformState({ components: ["down"], openIncidents: [] })).toBe("down");
  });

  it("annonce opérationnel sur un parc vide plutôt que de se taire", () => {
    // Aucun node déclaré : rien ne va mal, et un état indéfini obligerait
    // chaque écran à inventer quoi afficher.
    expect(platformState({ components: [], openIncidents: [] })).toBe("operational");
  });

  it("traite un incident sans impact comme sans effet", () => {
    expect(platformState({ components: ["operational"], openIncidents: ["none"] })).toBe(
      "operational",
    );
  });
});

describe("isIncidentOpen", () => {
  it("tient l'incident pour ouvert tant que la résolution n'est pas annoncée", () => {
    expect(isIncidentOpen("investigating")).toBe(true);
    expect(isIncidentOpen("identified")).toBe(true);
    expect(isIncidentOpen("monitoring")).toBe(true);
  });

  it("le clôt sur « resolved », et sur rien d'autre", () => {
    expect(isIncidentOpen("resolved")).toBe(false);
  });
});

describe("INCIDENT_IMPACTS", () => {
  it("va du moins grave au plus grave", () => {
    // L'ordre est lu par les écrans pour ranger un sélecteur : l'inverser
    // proposerait « critique » en premier choix.
    expect([...INCIDENT_IMPACTS]).toEqual(["none", "minor", "major", "critical"]);
  });
});
