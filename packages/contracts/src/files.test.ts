import { describe, expect, it } from "vitest";
import {
  bitsToMode,
  ChmodRequest,
  FileMode,
  modeToBits,
  octalFromSymbolic,
  RenameRequest,
  refusePath,
  renameRefusal,
} from "./files";

describe("mode de fichier accepté par le panel", () => {
  it("accepte trois chiffres octaux, de 000 à 777", () => {
    for (const mode of ["000", "644", "755", "700", "777"]) {
      expect(FileMode.safeParse(mode).success).toBe(true);
    }
  });

  it("refuse setuid, setgid et le bit collant", () => {
    // Le daemon convertit sans filtre (`os.FileMode(mode)`) : c'est ici, et
    // seulement ici, qu'un exécutable setuid est refusé.
    for (const mode of ["4755", "2755", "1777", "0755", "6777"]) {
      expect(FileMode.safeParse(mode).success).toBe(false);
    }
  });

  it("refuse ce qui n'est pas de l'octal", () => {
    for (const mode of ["", "8", "75", "888", "7a5", " 755", "rwx", "-755"]) {
      expect(FileMode.safeParse(mode).success).toBe(false);
    }
  });

  it("refuse un nombre, que le daemon ne sait pas décoder", () => {
    // `chmodFile.Mode` est un `string` côté Wings : un nombre JSON ferait
    // échouer tout le corps, sans message utile.
    expect(FileMode.safeParse(755).success).toBe(false);
  });
});

describe("corps d'une demande de chmod", () => {
  it("accepte la forme du daemon", () => {
    const parsed = ChmodRequest.parse({ root: "/", files: [{ file: "start.sh", mode: "755" }] });
    expect(parsed).toEqual({ root: "/", files: [{ file: "start.sh", mode: "755" }] });
  });

  it("refuse une liste vide, que le daemon refuserait en 422", () => {
    expect(ChmodRequest.safeParse({ root: "/", files: [] }).success).toBe(false);
  });

  it("refuse un nom vide et un champ inconnu", () => {
    expect(ChmodRequest.safeParse({ root: "/", files: [{ file: " ", mode: "644" }] }).success).toBe(
      false,
    );
    expect(
      ChmodRequest.safeParse({ root: "/", files: [{ file: "a", mode: "644", recursive: true }] })
        .success,
    ).toBe(false);
  });

  it("borne le nombre d'entrées", () => {
    const files = Array.from({ length: 101 }, (_, i) => ({ file: `f${i}`, mode: "644" }));
    expect(ChmodRequest.safeParse({ root: "/", files }).success).toBe(false);
  });
});

describe("lecture du mode affiché par Wings", () => {
  it("lit un fichier et un dossier", () => {
    expect(octalFromSymbolic("-rw-r--r--")).toBe("644");
    // Les lettres de type précèdent : les lire depuis le début décalerait tout.
    expect(octalFromSymbolic("drwxr-xr-x")).toBe("755");
  });

  it("ignore les lettres de type de Go, même multiples", () => {
    // `os.FileMode.String()` écrit setuid en tête (`u`), pas dans les neuf bits.
    expect(octalFromSymbolic("urwxr-xr-x")).toBe("755");
    expect(octalFromSymbolic("Lrwxrwxrwx")).toBe("777");
  });

  it("ne reprend pas les bits spéciaux de la forme Unix", () => {
    expect(octalFromSymbolic("-rwsr-xr-x")).toBe("755");
    expect(octalFromSymbolic("-rwSr--r--")).toBe("644");
    expect(octalFromSymbolic("drwxrwxrwt")).toBe("777");
  });

  it("rend null plutôt qu'un mode inventé", () => {
    expect(octalFromSymbolic("")).toBeNull();
    expect(octalFromSymbolic("0644")).toBeNull();
  });
});

describe("cases de permission", () => {
  it("font l'aller-retour avec le mode octal", () => {
    for (const mode of ["000", "644", "755", "640", "777", "421"]) {
      expect(bitsToMode(modeToBits(mode))).toBe(mode);
    }
  });

  it("placent chaque chiffre sur sa classe", () => {
    const bits = modeToBits("751");
    expect(bits.owner).toEqual({ read: true, write: true, execute: true });
    expect(bits.group).toEqual({ read: true, write: false, execute: true });
    expect(bits.others).toEqual({ read: false, write: false, execute: true });
  });
});

describe("cible d'un renommage", () => {
  it("accepte un nom et un déplacement relatif", () => {
    expect(renameRefusal("a.txt", "b.txt")).toBeNull();
    expect(renameRefusal("a.txt", "archives/a.txt")).toBeNull();
    expect(renameRefusal("a.txt", "../a.txt")).toBeNull();
  });

  it("refuse un nom vide", () => {
    expect(renameRefusal("a.txt", "")).toBe("empty");
    expect(renameRefusal("a.txt", "   ")).toBe("empty");
    expect(renameRefusal("a.txt", "/")).toBe("empty");
  });

  it("refuse un « / » final, que le daemon prendrait pour un nom", () => {
    expect(renameRefusal("a.txt", "plugins/")).toBe("trailingSlash");
  });

  it("refuse un nom inchangé", () => {
    expect(renameRefusal("a.txt", " a.txt ")).toBe("unchanged");
  });

  it("l'API applique la même règle et rogne la cible", () => {
    expect(RenameRequest.safeParse({ root: "/", from: "a", to: "" }).success).toBe(false);
    expect(RenameRequest.safeParse({ root: "/", from: "a", to: "x/" }).success).toBe(false);
    expect(RenameRequest.parse({ root: "/", from: "a", to: " b " }).to).toBe("b");
  });
});

describe("chemin relayé au daemon", () => {
  it("laisse passer un chemin du volume, absolu ou relatif à son dossier", () => {
    expect(refusePath("/")).toBeNull();
    expect(refusePath("/plugins/a.jar")).toBeNull();
    expect(refusePath("a.jar", "/plugins")).toBeNull();
    expect(refusePath("mondes/./nether", "/")).toBeNull();
  });

  it("laisse remonter tant qu'on reste dans le volume", () => {
    // `../a.jar` depuis `plugins` : le déplacement que l'écran propose.
    expect(refusePath("../a.jar", "/plugins")).toBeNull();
    expect(refusePath("/plugins/../server.properties")).toBeNull();
  });

  it("refuse ce qui remonte au-dessus de la racine du volume", () => {
    expect(refusePath("/../../etc/passwd")).toBe("outsideVolume");
    expect(refusePath("..")).toBe("outsideVolume");
    expect(refusePath("../a.jar", "/")).toBe("outsideVolume");
    expect(refusePath("../../a.jar", "/plugins")).toBe("outsideVolume");
    expect(refusePath("/plugins/../../a")).toBe("outsideVolume");
  });

  it("refuse un octet nul, dans le chemin comme dans son dossier", () => {
    expect(refusePath("/a\0b")).toBe("nullByte");
    expect(refusePath("a", "/pl\0ugins")).toBe("nullByte");
  });

  it("ne prend pas l'antislash pour un séparateur : le daemon tourne sous Linux", () => {
    expect(refusePath("..\\a")).toBeNull();
  });
});
