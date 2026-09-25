import { describe, expect, it } from "vitest";
import { daysUntil, readableBillingProvider, readServiceState } from "./billing";

describe("daysUntil", () => {
  const today = new Date("2026-03-10T23:30:00Z");

  it("compte en jours de calendrier, pas en tranches de 24 h", () => {
    // 23 h 30 le 10 : l'échéance du 11 est bien « demain », et non « dans
    // 0 jour » parce qu'il reste moins de vingt-quatre heures.
    expect(daysUntil("2026-03-11", today)).toBe(1);
  });

  it("rend 0 le jour même, quelle que soit l'heure", () => {
    expect(daysUntil("2026-03-10", today)).toBe(0);
    expect(daysUntil("2026-03-10", new Date("2026-03-10T00:00:01Z"))).toBe(0);
  });

  it("rend un nombre négatif pour une échéance passée", () => {
    // Ramener à zéro ferait dire « échéance aujourd'hui » à une facture en
    // retard de trois semaines.
    expect(daysUntil("2026-02-17", today)).toBe(-21);
  });

  it("accepte un horodatage complet et n'en garde que la date", () => {
    expect(daysUntil("2026-03-20 14:00:00", today)).toBe(10);
  });

  it("refuse la date nulle de HostBill plutôt que de compter depuis l'an zéro", () => {
    expect(daysUntil("0000-00-00", today)).toBeNull();
  });

  it("refuse ce qui n'est pas une date", () => {
    expect(daysUntil("", today)).toBeNull();
    expect(daysUntil("bientôt", today)).toBeNull();
  });

  it("franchit un changement de mois et une année bissextile", () => {
    expect(daysUntil("2026-03-01", new Date("2026-02-28T12:00:00Z"))).toBe(1);
    expect(daysUntil("2028-03-01", new Date("2028-02-28T12:00:00Z"))).toBe(2);
  });
});

describe("readServiceState", () => {
  it("reconnaît les états de HostBill sans se soucier de la casse", () => {
    expect(readServiceState("Active")).toBe("active");
    expect(readServiceState("SUSPENDED")).toBe("suspended");
  });

  it("accepte les deux orthographes de « cancelled »", () => {
    expect(readServiceState("cancelled")).toBe("cancelled");
    expect(readServiceState("canceled")).toBe("cancelled");
  });

  it("reconnaît les fins de service de WHMCS et de ClientXCMS", () => {
    expect(readServiceState("Terminated")).toBe("cancelled");
    expect(readServiceState("Completed")).toBe("cancelled");
    expect(readServiceState("expired")).toBe("cancelled");
  });

  it("rend « unknown » plutôt que d'inventer un état", () => {
    // Un état inconnu affiché comme « actif » ferait croire à un service en
    // service alors qu'il vient d'être fermé.
    expect(readServiceState("fraud")).toBe("unknown");
    expect(readServiceState(undefined)).toBe("unknown");
    expect(readServiceState(42)).toBe("unknown");
  });
});

describe("readableBillingProvider", () => {
  it("reconnaît les trois facturiers lisibles", () => {
    expect(readableBillingProvider("hostbill")).toBe("hostbill");
    expect(readableBillingProvider("whmcs")).toBe("whmcs");
    expect(readableBillingProvider("clientxcms")).toBe("clientxcms");
  });

  it("écarte « aucun », « sur mesure » et tout le reste", () => {
    // Une boutique sur mesure n'a pas d'API de lecture connue : l'interroger
    // comme si c'était HostBill serait précisément le défaut corrigé ici.
    expect(readableBillingProvider("none")).toBeNull();
    expect(readableBillingProvider("custom")).toBeNull();
    expect(readableBillingProvider("")).toBeNull();
    expect(readableBillingProvider(undefined)).toBeNull();
  });
});
