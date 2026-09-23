import type { Database } from "@gamedashboard/db";
import { describe, expect, it, vi } from "vitest";
import { ActivityService, type PlatformActivityEntry } from "./activity.service";
import { AUDIT_CSV_COLUMNS, auditExportFile, csvCell, csvRow } from "./audit-export";

/** Une ligne de journal plausible, dont chaque test ne change que ce qu'il éprouve. */
function entry(overrides: Partial<PlatformActivityEntry> = {}): PlatformActivityEntry {
  return {
    id: "0b6c1f0e-1d7a-4c52-9a55-0d7d6b7c1a01",
    event: "server.power.start",
    actorId: "5d0b6d0c-7a55-4a0e-8b1f-2f1c0f3e9a10",
    actorLabel: "Camille Martin",
    actorType: "user",
    ip: "203.0.113.7",
    properties: {},
    at: "2026-09-23 10:00:00.123+00",
    serverId: null,
    serverName: null,
    ...overrides,
  };
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of chunks) out += chunk;
  return out;
}

async function* of(...entries: PlatformActivityEntry[]): AsyncGenerator<PlatformActivityEntry> {
  for (const e of entries) yield e;
}

describe("cellule CSV", () => {
  it("entoure toute valeur de guillemets et double ceux qu'elle contient", () => {
    expect(csvCell("simple")).toBe('"simple"');
    expect(csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""');
  });

  it("ne laisse ni virgule ni saut de ligne fabriquer une colonne ou une ligne", () => {
    // Un nom de serveur « a,b\nc » ne doit pas décaler les colonnes suivantes
    // ni inventer une ligne dans le fichier de l'administrateur.
    expect(csvCell("a,b\nc\r\nd")).toBe('"a,b\nc\r\nd"');
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "neutralise une valeur commençant par %j",
    (trigger) => {
      const value = `${trigger}HYPERLINK("http://exemple.invalid";"clic")`;
      const cell = csvCell(value);
      // L'apostrophe en tête force le tableur à lire du texte.
      expect(cell.startsWith(`"'${trigger}`)).toBe(true);
    },
  );

  it("désamorce la formule même quand elle porte des guillemets", () => {
    expect(csvCell('=1+1"')).toBe(`"'=1+1"""`);
  });

  it("ne touche pas une valeur où le déclencheur n'est pas en tête", () => {
    expect(csvCell("a=b")).toBe('"a=b"');
    expect(csvCell("2026-09-23")).toBe('"2026-09-23"');
  });

  it("rend vide ce qui est nul, et en JSON ce qui est un objet", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell({ a: "x,y" })).toBe('"{""a"":""x,y""}"');
  });
});

describe("fichier d'export", () => {
  it("CSV : marque d'ordre, en-tête, une ligne par entrée, CRLF", async () => {
    const file = auditExportFile(
      "csv",
      of(entry(), entry({ actorLabel: "=cmd|' /C calc'!A0" })),
      new Date("2026-09-23T10:11:12Z"),
    );

    expect(file.filename).toBe("journal-2026-09-23T10-11-12.csv");
    expect(file.contentType).toContain("text/csv");

    const text = await collect(file.chunks);
    expect(text.startsWith("\uFEFF")).toBe(true);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe(AUDIT_CSV_COLUMNS.map((c) => `"${c}"`).join(","));
    expect(lines).toHaveLength(4); // en-tête, deux lignes, et la fin de ligne finale
    expect(lines[3]).toBe("");
    // Le nom piégé arrive désamorcé.
    expect(lines[2]).toContain(`"'=cmd|' /C calc'!A0"`);
  });

  it("CSV : chaque ligne a autant de colonnes que l'en-tête", () => {
    const line = csvRow(entry({ properties: { note: "a,b" }, serverName: 'x"y' }));
    // Découpe naïve sur `","` : valable parce que toute cellule est entre guillemets.
    expect(line.trimEnd().slice(1, -1).split('","')).toHaveLength(AUDIT_CSV_COLUMNS.length);
  });

  it("JSON : un objet par ligne, valeurs intactes", async () => {
    const piege = entry({ actorLabel: "=1+1" });
    const file = auditExportFile("jsonl", of(entry(), piege));
    const text = await collect(file.chunks);
    const lines = text.trimEnd().split("\n");

    expect(file.filename.endsWith(".jsonl")).toBe(true);
    expect(lines.map((l) => JSON.parse(l))).toEqual([entry(), piege]);
  });
});

describe("trace de l'export", () => {
  it("ne livre rien si la trace ne s'écrit pas", async () => {
    // À rebours de `record()`, qui avale l'échec : un export non tracé
    // laisserait sortir le journal sans que personne ne le sache.
    const select = vi.fn();
    const db = {
      insert: () => ({
        values: async () => {
          throw new Error("base en lecture seule");
        },
      }),
      select,
    } as unknown as Database;

    await expect(
      new ActivityService(db).exportPlatform({
        filters: {},
        format: "csv",
        actor: { id: "5d0b6d0c-7a55-4a0e-8b1f-2f1c0f3e9a10", label: "admin@exemple.fr" },
      }),
    ).rejects.toThrow("base en lecture seule");
    expect(select).not.toHaveBeenCalled();
  });
});
