import { describe, expect, it } from "vitest";
import {
  buildStatusRequest,
  decodeVarInt,
  encodeVarInt,
  PLAYER_SAMPLE_MAX,
  parseStatusJson,
  readStatusResponse,
} from "./minecraft-ping";

/**
 * Le VarInt porte toutes les longueurs du protocole. Une seule mal codée
 * décale la trame entière, et le serveur ferme la connexion sans rien dire —
 * ce qui se diagnostique très mal depuis l'autre bout.
 */
describe("VarInt", () => {
  it("code les valeurs de référence du protocole", () => {
    expect([...encodeVarInt(0)]).toEqual([0x00]);
    expect([...encodeVarInt(1)]).toEqual([0x01]);
    expect([...encodeVarInt(127)]).toEqual([0x7f]);
    expect([...encodeVarInt(128)]).toEqual([0x80, 0x01]);
    expect([...encodeVarInt(255)]).toEqual([0xff, 0x01]);
    expect([...encodeVarInt(25565)]).toEqual([0xdd, 0xc7, 0x01]);
  });

  it("relit ce qu'il a écrit", () => {
    for (const value of [0, 1, 127, 128, 300, 25565, 2_097_151, 1_000_000]) {
      const decoded = decodeVarInt(encodeVarInt(value));
      expect(decoded?.value).toBe(value);
    }
  });

  it("rend null sur une trame trop courte plutôt qu'une valeur partielle", () => {
    // Lecture en cours, pas erreur : l'appelant rappellera avec la suite.
    expect(decodeVarInt(Buffer.from([0x80]))).toBe(null);
    expect(decodeVarInt(Buffer.from([]))).toBe(null);
  });

  it("refuse une trame corrompue plutôt que de lire n'importe quoi", () => {
    // Au-delà de cinq octets, la valeur ne tient plus dans un entier 32 bits.
    expect(decodeVarInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]))).toBe(null);
  });
});

describe("demande d'état", () => {
  it("annonce une version de protocole indéterminée", () => {
    /*
     * -1 veut dire « je ne me prononce pas ». Un serveur répond alors sans
     * refuser au motif d'une version incompatible — ce qu'on veut, puisqu'on
     * ne cherche pas à jouer mais à compter.
     */
    const frame = buildStatusRequest("localhost", 25565);
    expect(frame.includes(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]))).toBe(true);
  });

  it("écrit le port sur deux octets, en gros-boutien", () => {
    // 25565 = 0x63DD. Inversé, le serveur répondrait sur un autre port ou pas
    // du tout, et la sonde conclurait « injoignable » sur un serveur sain.
    const frame = buildStatusRequest("localhost", 25565);
    expect(frame.includes(Buffer.from([0x63, 0xdd]))).toBe(true);
  });

  it("porte le nom d'hôte, que certains serveurs exigent", () => {
    // Les serveurs derrière un proxy s'en servent pour router : l'omettre les
    // ferait répondre pour le mauvais serveur, ou pas du tout.
    expect(buildStatusRequest("jeu.exemple.fr", 25565).includes("jeu.exemple.fr")).toBe(true);
  });
});

describe("lecture de la réponse", () => {
  /** Enveloppe un JSON comme le ferait un serveur. */
  function frame(json: string): Buffer {
    const body = Buffer.from(json, "utf8");
    const payload = Buffer.concat([encodeVarInt(0x00), encodeVarInt(body.length), body]);
    return Buffer.concat([encodeVarInt(payload.length), payload]);
  }

  it("lit les joueurs et la version", () => {
    const status = readStatusResponse(
      frame(
        JSON.stringify({ players: { online: 7, max: 20 }, version: { name: "Paper 1.21.11" } }),
      ),
    );
    expect(status).toEqual({
      playersOnline: 7,
      playersMax: 20,
      version: "Paper 1.21.11",
      sample: null,
    });
  });

  it("attend la suite plutôt que de conclure sur une trame incomplète", () => {
    /*
     * La réponse tient rarement dans un seul paquet TCP. Conclure trop tôt
     * donnerait un serveur « injoignable » qui répondait parfaitement.
     */
    const complete = frame(JSON.stringify({ players: { online: 1, max: 2 } }));
    expect(readStatusResponse(complete.subarray(0, complete.length - 10))).toBe(null);
  });

  it("ne prend pas un autre service pour un serveur Minecraft", () => {
    // Un identifiant de paquet inattendu : on parle à autre chose.
    const body = Buffer.from("{}", "utf8");
    const payload = Buffer.concat([encodeVarInt(0x42), encodeVarInt(body.length), body]);
    const wrong = Buffer.concat([encodeVarInt(payload.length), payload]);
    expect(readStatusResponse(wrong)).toBe(null);
  });
});

describe("JSON d'état", () => {
  it("ne confond jamais « zéro joueur » et « je n'ai pas su lire »", () => {
    /*
     * Le contenu vient d'un serveur que le client contrôle. Un champ absent
     * doit donner `null`, pas zéro : afficher « 0 joueur » sur un serveur
     * plein est pire que d'afficher « inconnu ».
     */
    expect(parseStatusJson("{}")).toEqual({
      playersOnline: null,
      playersMax: null,
      version: null,
      sample: null,
    });
    expect(
      parseStatusJson(JSON.stringify({ players: { online: 0, max: 20 } }))?.playersOnline,
    ).toBe(0);
  });

  it("écarte un champ du mauvais type", () => {
    // Un serveur modifié peut renvoyer n'importe quoi : on ne le croit pas
    // sur parole.
    const status = parseStatusJson(JSON.stringify({ players: { online: "beaucoup", max: null } }));
    expect(status?.playersOnline).toBe(null);
    expect(status?.playersMax).toBe(null);
  });

  it("lit l'échantillon de joueurs sans les lignes décoratives ni les noms dangereux", () => {
    const status = parseStatusJson(
      JSON.stringify({
        players: {
          online: 4,
          max: 20,
          sample: [
            { name: "Steve", id: "069a79f4-44e9-4726-a5be-fca90e38aaf5" },
            { name: "§6Bienvenue", id: "00000000-0000-0000-0000-000000000000" },
            { name: "Alex", id: "00000000-0000-0000-0000-000000000000" },
            { name: "x\nop x", id: "1" },
            { name: "Steve", id: "069a79f4-44e9-4726-a5be-fca90e38aaf5" },
            { name: 12 },
            null,
            { name: ".Bedrock", id: "2" },
          ],
        },
      }),
    );
    expect(status?.sample).toEqual(["Steve", ".Bedrock"]);
  });

  it("borne l'échantillon, et distingue « absent » de « vide »", () => {
    const sample = Array.from({ length: 500 }, (_, i) => ({ name: `p${i}`, id: String(i) }));
    const plein = parseStatusJson(JSON.stringify({ players: { online: 500, sample } }));
    expect(plein?.sample).toHaveLength(PLAYER_SAMPLE_MAX);
    expect(parseStatusJson(JSON.stringify({ players: { sample: [] } }))?.sample).toEqual([]);
    expect(parseStatusJson(JSON.stringify({ players: { online: 0 } }))?.sample).toBe(null);
  });

  it("rend null sur un JSON invalide", () => {
    expect(parseStatusJson("pas du json")).toBe(null);
  });
});
