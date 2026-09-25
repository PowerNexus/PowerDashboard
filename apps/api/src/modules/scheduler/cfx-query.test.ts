import { describe, expect, it } from "vitest";
import { cfxStatus, parseCfxInfo, parseCfxPlayers } from "./cfx-query";
import { PLAYER_SAMPLE_MAX } from "./game-status";

/** Un `/info.json` de FXServer, réduit à ce qui compte. */
const INFO = JSON.stringify({
  enhancedHostSupport: true,
  resources: ["mapmanager", "chat", "spawnmanager"],
  server: "FXServer-master SERVER v1.0.0.12345 linux",
  vars: { sv_maxClients: "48", sv_projectName: "^1Mon ^7Serveur RP", gamename: "gta5" },
  version: 123456,
});

describe("/info.json", () => {
  it("lit la version, le plafond et le nom sans codes de couleur", () => {
    expect(parseCfxInfo(INFO)).toEqual({
      name: "Mon Serveur RP",
      version: "FXServer-master SERVER v1.0.0.12345 linux",
      playersMax: 48,
    });
  });

  it("ne croit pas un plafond qui n'est pas un entier", () => {
    const info = parseCfxInfo(JSON.stringify({ vars: { sv_maxClients: "beaucoup" } }));
    expect(info).toEqual({ name: null, version: null, playersMax: null });
  });

  it("refuse le JSON d'un service qui n'est pas FXServer", () => {
    expect(parseCfxInfo('{"status":"ok"}')).toBeNull();
    expect(parseCfxInfo("[]")).toBeNull();
    expect(parseCfxInfo("<html>")).toBeNull();
  });
});

describe("/players.json", () => {
  it("ne retient que les noms, jamais les identifiants", () => {
    const raw = JSON.stringify([
      { id: 1, name: "^2Jean Dupont", identifiers: ["license:abc", "ip:203.0.113.4"], ping: 40 },
      { id: 2, name: "Alice", identifiers: ["steam:110000100000000"], ping: 20 },
      { id: 3, ping: 20 },
    ]);
    expect(parseCfxPlayers(raw)).toEqual({ online: 3, names: ["Jean Dupont", "Alice"] });
    expect(JSON.stringify(parseCfxPlayers(raw))).not.toContain("203.0.113.4");
  });

  it("compte tous les joueurs mais plafonne les noms", () => {
    const raw = JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ name: `J${i}` })));
    const lu = parseCfxPlayers(raw);
    expect(lu?.online).toBe(300);
    expect(lu?.names).toHaveLength(PLAYER_SAMPLE_MAX);
  });

  it("refuse ce qui n'est pas une liste", () => {
    expect(parseCfxPlayers('{"players":[]}')).toBeNull();
    expect(parseCfxPlayers("pas du json")).toBeNull();
  });
});

describe("forme rangée en base", () => {
  const info = { name: "RP", version: "FXServer", playersMax: 48 };

  it("reprend les champs communs à tous les jeux", () => {
    expect(cfxStatus(info, { online: 2, names: ["A", "B"] })).toEqual({
      playersOnline: 2,
      playersMax: 48,
      version: "FXServer",
      sample: ["A", "B"],
      name: "RP",
    });
  });

  it("laisse le compteur inconnu sans la liste, plutôt que zéro", () => {
    expect(cfxStatus(info, null)).toMatchObject({ playersOnline: null, sample: null });
  });
});
