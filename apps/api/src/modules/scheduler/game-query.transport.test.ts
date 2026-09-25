import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { serveurA2s, trameInfo } from "../../test/a2s-frames";
import { httpGet, queryA2s, queryCfx } from "./game-query.transport";

/**
 * Les sondes A2S et Cfx.re, contre de vrais serveurs locaux (UDP et HTTP) :
 * c'est sur la socket que se jouent le défi, les délais et les réponses
 * refusées.
 */

const fermetures: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(fermetures.splice(0).map((fermer) => fermer()));
});

async function a2s(options: Parameters<typeof serveurA2s>[0]) {
  const serveur = await serveurA2s(options);
  fermetures.push(serveur.fermer);
  return serveur;
}

describe("sonde A2S", () => {
  it("renvoie le défi pour l'information comme pour les joueurs", async () => {
    const serveur = await a2s({ info: trameInfo({ joueurs: 2, max: 10 }), joueurs: ["A", "B"] });

    expect(await queryA2s("127.0.0.1", serveur.port)).toEqual({
      playersOnline: 2,
      playersMax: 10,
      version: "2590",
      sample: ["A", "B"],
      name: "Rust FR #1",
      map: "Procedural Map",
    });
    // Information, information + défi, joueurs, joueurs + défi.
    expect(serveur.demandes.map((d) => d[4])).toEqual([0x54, 0x54, 0x55, 0x55]);
  });

  it("reste joignable sans noms quand la liste arrive en plusieurs datagrammes", async () => {
    const serveur = await a2s({ joueurs: "split" });
    const statut = await queryA2s("127.0.0.1", serveur.port);
    expect(statut).toMatchObject({ playersOnline: 3, sample: null });
  });

  it("reste joignable sans noms quand la liste ne vient jamais", async () => {
    const serveur = await a2s({ joueurs: "muet" });
    const statut = await queryA2s("127.0.0.1", serveur.port, 200);
    expect(statut).toMatchObject({ playersOnline: 3, sample: null });
  });

  it("rend null sur un port où personne n'écoute", async () => {
    const serveur = await a2s({});
    await serveur.fermer();
    fermetures.pop();
    expect(await queryA2s("127.0.0.1", serveur.port, 500)).toBeNull();
  });
});

async function http(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const serveur: Server = createServer(handler);
  await new Promise<void>((resolve) => serveur.listen(0, "127.0.0.1", resolve));
  fermetures.push(() => new Promise((resolve) => serveur.close(() => resolve())));
  const adresse = serveur.address();
  if (adresse === null || typeof adresse === "string") throw new Error("port introuvable");
  return adresse.port;
}

describe("sonde Cfx.re", () => {
  it("lit /info.json et /players.json", async () => {
    const port = await http((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/info.json") {
        res.end(JSON.stringify({ server: "FXServer", vars: { sv_maxClients: "32" } }));
      } else if (req.url === "/players.json") {
        res.end(JSON.stringify([{ name: "Alice" }, { name: "Jean Dupont" }]));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    expect(await queryCfx("127.0.0.1", port)).toEqual({
      playersOnline: 2,
      playersMax: 32,
      version: "FXServer",
      sample: ["Alice", "Jean Dupont"],
      name: null,
    });
  });

  it("rend null quand /info.json manque", async () => {
    const port = await http((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    expect(await queryCfx("127.0.0.1", port)).toBeNull();
  });

  it("n'attend pas au-delà du délai", async () => {
    const port = await http(() => undefined);
    const debut = Date.now();
    expect(await queryCfx("127.0.0.1", port, 200)).toBeNull();
    expect(Date.now() - debut).toBeLessThan(2000);
  });

  it("abandonne une réponse plus grosse que la borne", async () => {
    const port = await http((_req, res) => {
      res.write("x".repeat(1024));
      res.end("x".repeat(1024));
    });
    expect(await httpGet("127.0.0.1", port, "/info.json", 1500)).toBeNull();
    expect(await httpGet("127.0.0.1", port, "/info.json", 4096)).toHaveLength(2048);
  });
});
