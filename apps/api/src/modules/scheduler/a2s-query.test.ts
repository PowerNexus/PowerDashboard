import { isPlayerName, renderPlayerCommand } from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";
import { chaine, entete, trameDefi, trameInfo, trameJoueurs } from "../../test/a2s-frames";
import { a2sStatus, buildInfoRequest, buildPlayerRequest, readA2sResponse } from "./a2s-query";
import { PLAYER_SAMPLE_MAX } from "./game-status";

describe("demandes A2S", () => {
  it("écrit la demande d'information, avec ou sans défi", () => {
    expect(buildInfoRequest().toString("latin1")).toBe("\xff\xff\xff\xffTSource Engine Query\0");
    expect([...buildInfoRequest(Buffer.from([1, 2, 3, 4])).subarray(-4)]).toEqual([1, 2, 3, 4]);
  });

  it("réclame un défi pour la liste des joueurs, puis le renvoie", () => {
    expect([...buildPlayerRequest()]).toEqual([
      0xff, 0xff, 0xff, 0xff, 0x55, 0xff, 0xff, 0xff, 0xff,
    ]);
    expect([...buildPlayerRequest(Buffer.from([9, 8, 7, 6])).subarray(5)]).toEqual([9, 8, 7, 6]);
  });
});

describe("réponses A2S", () => {
  it("lit l'information d'un serveur Source", () => {
    expect(readA2sResponse(trameInfo({ joueurs: 12, max: 50 }))).toEqual({
      kind: "info",
      info: {
        name: "Rust FR #1",
        map: "Procedural Map",
        playersOnline: 12,
        playersMax: 50,
        version: "2590",
      },
    });
  });

  it("saute les trois octets propres à The Ship", () => {
    const lu = readA2sResponse(trameInfo({ appId: 2400, version: "1.0" }));
    expect(lu?.kind === "info" && lu.info.version).toBe("1.0");
  });

  it("garde une information sans version", () => {
    const lu = readA2sResponse(trameInfo({ version: null }));
    expect(lu?.kind === "info" && lu.info.version).toBeNull();
  });

  it("lit l'ancienne réponse GoldSrc", () => {
    const trame = Buffer.concat([
      entete(0x6d),
      chaine("127.0.0.1:27015"),
      chaine("CS 1.6"),
      chaine("de_dust2"),
      chaine("cstrike"),
      chaine("Counter-Strike"),
      Buffer.from([5, 32, 48]),
    ]);
    expect(readA2sResponse(trame)).toEqual({
      kind: "info",
      info: { name: "CS 1.6", map: "de_dust2", playersOnline: 5, playersMax: 32, version: null },
    });
  });

  it("lit un défi", () => {
    expect(readA2sResponse(trameDefi([0xde, 0xad, 0xbe, 0xef]))).toEqual({
      kind: "challenge",
      challenge: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    });
  });

  it("signale une réponse en plusieurs datagrammes, sans la lire", () => {
    const trame = Buffer.from([0xfe, 0xff, 0xff, 0xff, 1, 2, 3, 4, 2, 0]);
    expect(readA2sResponse(trame)).toEqual({ kind: "split" });
  });

  it("refuse ce qui n'est pas une réponse A2S", () => {
    expect(readA2sResponse(Buffer.from("HTTP/1.1 200 OK\r\n\r\n"))).toBeNull();
    expect(readA2sResponse(Buffer.from([0xff, 0xff, 0xff]))).toBeNull();
    expect(readA2sResponse(Buffer.concat([entete(0x42), Buffer.alloc(8)]))).toBeNull();
    // Information tronquée : le nom n'est jamais terminé.
    expect(
      readA2sResponse(Buffer.concat([entete(0x49), Buffer.from([17, 0x41, 0x42])])),
    ).toBeNull();
    expect(readA2sResponse(entete(0x41))).toBeNull();
  });

  it("lit les noms, sans les joueurs en cours de connexion", () => {
    expect(readA2sResponse(trameJoueurs(["Alice", "", "Bob"]))).toEqual({
      kind: "players",
      names: ["Alice", "Bob"],
    });
  });

  it("garde les noms lus en entier d'une liste tronquée", () => {
    const trame = trameJoueurs(["Alice", "Bob"]);
    expect(readA2sResponse(trame.subarray(0, trame.length - 3))).toEqual({
      kind: "players",
      names: ["Alice"],
    });
  });
});

describe("noms venus d'un jeu Steam", () => {
  it("nettoie, dédoublonne et plafonne", () => {
    const lu = readA2sResponse(
      trameJoueurs(["  Joueur\tUn \u0007", "Joueur Un", "x".repeat(200), "\u202eEvil"]),
    );
    expect(lu).toEqual({
      kind: "players",
      names: ["Joueur Un", "x".repeat(64), "Evil"],
    });
    const beaucoup = readA2sResponse(trameJoueurs(Array.from({ length: 200 }, (_, i) => `J${i}`)));
    expect(beaucoup?.kind === "players" && beaucoup.names.length).toBe(PLAYER_SAMPLE_MAX);
  });

  it("n'ouvre aucune commande à un nom qui porte une espace", () => {
    // Le nom s'affiche, mais la vue joueurs n'y propose pas d'action : la
    // commande serait coupée en deux.
    expect(isPlayerName("Joueur Un")).toBe(false);
    expect(renderPlayerCommand("kick {player}", "Joueur Un")).toBeNull();
  });
});

describe("forme rangée en base", () => {
  it("reprend les champs communs à tous les jeux, enrichis du nom et de la carte", () => {
    const info = {
      name: "Rust FR",
      map: "Procedural Map",
      playersOnline: 3,
      playersMax: 100,
      version: "2590",
    };
    expect(a2sStatus(info, ["Alice"])).toEqual({
      playersOnline: 3,
      playersMax: 100,
      version: "2590",
      sample: ["Alice"],
      name: "Rust FR",
      map: "Procedural Map",
    });
    expect(a2sStatus(info, null).sample).toBeNull();
  });
});
