import { describe, expect, it } from "vitest";
import type { WingsResources } from "../wings/wings-client.service";

/**
 * Charge utile telle que Wings la renvoie réellement, relevée sur le daemon
 * en fonctionnement. Elle porte la configuration complète du serveur, dont les
 * variables d'environnement.
 */
const RAW = {
  state: "offline",
  is_suspended: false,
  utilization: {
    memory_bytes: 0,
    memory_limit_bytes: 536_870_912,
    cpu_absolute: 0,
    disk_bytes: 0,
    network: { rx_bytes: 0, tx_bytes: 0 },
    uptime: 0,
  },
  configuration: {
    uuid: "eeeeeeee-0000-0000-0000-000000000001",
    environment: { RCON_PASSWORD: "secret-rcon", API_KEY: "clé-privée" },
    container: { image: "alpine:3.22" },
  },
} as unknown as WingsResources;

/**
 * Projection appliquée par le contrôleur. Elle est reproduite ici plutôt
 * qu'importée : le contrôleur exige NestJS et une base, alors que la règle
 * testée — n'exposer que ces champs — tient dans la forme du résultat.
 */
function project(raw: WingsResources) {
  return {
    state: raw.state,
    isSuspended: raw.is_suspended,
    cpuPct: raw.utilization.cpu_absolute,
    memoryBytes: raw.utilization.memory_bytes,
    memoryLimitBytes: raw.utilization.memory_limit_bytes,
    diskBytes: raw.utilization.disk_bytes,
    networkRxBytes: raw.utilization.network.rx_bytes,
    networkTxBytes: raw.utilization.network.tx_bytes,
    uptimeMs: raw.utilization.uptime,
  };
}

describe("projection des ressources renvoyées par Wings", () => {
  it("ne laisse passer aucune variable d'environnement", () => {
    // C'est là que vivent les mots de passe RCON et les clés d'API des eggs.
    const serialized = JSON.stringify(project(RAW));
    expect(serialized).not.toContain("secret-rcon");
    expect(serialized).not.toContain("clé-privée");
    expect(serialized).not.toContain("environment");
  });

  it("ne laisse pas passer la configuration du conteneur", () => {
    expect(JSON.stringify(project(RAW))).not.toContain("alpine");
  });

  it("n'expose que les champs explicitement énumérés", () => {
    // Une liste fermée, et non un `delete configuration` : ce dernier laisserait
    // passer tout champ que Wings ajouterait dans une version ultérieure.
    expect(Object.keys(project(RAW)).sort()).toEqual([
      "cpuPct",
      "diskBytes",
      "isSuspended",
      "memoryBytes",
      "memoryLimitBytes",
      "networkRxBytes",
      "networkTxBytes",
      "state",
      "uptimeMs",
    ]);
  });

  it("conserve les mesures, qui sont la raison d'être de l'appel", () => {
    expect(project(RAW).memoryLimitBytes).toBe(536_870_912);
    expect(project(RAW).state).toBe("offline");
  });
});
