import { describe, expect, it } from "vitest";
import { nomDuMonde } from "./pack-workspace";

/** Le dossier du monde, où vont les datapacks d'un pack CurseForge. */
describe("nomDuMonde", () => {
  it("lit level-name, échappements compris, et retombe sur world", () => {
    expect(nomDuMonde("motd=x\nlevel-name=monde\\ principal\n")).toBe("monde principal");
    expect(nomDuMonde("level-name = aventure\r\n")).toBe("aventure");
    expect(nomDuMonde("motd=x\n")).toBe("world");
    expect(nomDuMonde("level-name=\n")).toBe("world");
    expect(nomDuMonde(null)).toBe("world");
  });

  it("refuse un nom qui n'est pas un simple dossier", () => {
    expect(nomDuMonde("level-name=../ailleurs")).toBeNull();
    expect(nomDuMonde("level-name=a/b")).toBeNull();
    expect(nomDuMonde("level-name=.gamedashboard-pack")).toBeNull();
  });
});
