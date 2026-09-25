import { describe, expect, it } from "vitest";
import { clearCommandHistories, parseCommandHistory } from "./command-history";

describe("historique des commandes dans le navigateur", () => {
  it("relit une liste de commandes", () => {
    expect(parseCommandHistory('["say bonjour","list"]')).toEqual(["say bonjour", "list"]);
  });

  it("écarte une valeur illisible au lieu de faire tomber la console", () => {
    expect(parseCommandHistory(null)).toEqual([]);
    expect(parseCommandHistory("pas du json")).toEqual([]);
    expect(parseCommandHistory('{"a":1}')).toEqual([]);
    // Une entrée plus longue que ce que l'API accepte n'a pas été tapée ici.
    const melange = JSON.stringify(["ok", 3, null, "", "x".repeat(9000)]);
    expect(parseCommandHistory(melange)).toEqual(["ok"]);
  });

  it("garde cent commandes au plus", () => {
    const long = JSON.stringify(Array.from({ length: 150 }, (_, i) => `c${i}`));
    expect(parseCommandHistory(long)).toHaveLength(100);
  });

  it("efface à la déconnexion l'historique de chaque serveur, et rien d'autre", () => {
    const store = new Map([
      ["gd.console.history.a", "[]"],
      ["gd.console.history.b", "[]"],
      ["gd.announcements", "[]"],
    ]);
    const storage = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
    };
    clearCommandHistories(storage);
    expect([...store.keys()]).toEqual(["gd.announcements"]);
  });
});
