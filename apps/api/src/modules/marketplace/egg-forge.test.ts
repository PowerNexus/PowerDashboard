import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Le script d'installation de l'egg « Minecraft Java », joué pour de bon.
 *
 * C'est lui qui pose Forge et NeoForge quand le panel installe un modpack :
 * le panel ne fait que régler ses variables et relancer l'installation. Le
 * script tourne ici dans un dossier jetable (`GD_RACINE_ESSAI`), avec des
 * `apt-get`, `curl` et `java` de substitution : aucun réseau, aucun Java. Ce
 * qu'on vérifie est ce qui dépend du script — l'adresse de l'installeur, et
 * la commande de démarrage qu'il écrit pour la version installée.
 */

const SCRIPT = fileURLToPath(
  new URL("../../../../../infra/eggs/minecraft-java/install.sh", import.meta.url),
);
const BASH = existsSync("/bin/bash") || existsSync("/usr/bin/bash");

const dossiers: string[] = [];

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

function outil(bin: string, nom: string, corps: string): void {
  const chemin = join(bin, nom);
  writeFileSync(chemin, `#!/bin/bash\n${corps}\n`);
  chmodSync(chemin, 0o755);
}

/**
 * Joue le script. `installe` : fichiers que le faux installeur Java crée,
 * relatifs à la racine du serveur ; `javaEchoue` : l'installeur sort en erreur.
 */
function jouer(options: {
  env: Record<string, string>;
  avant?: Record<string, string>;
  installe?: string[];
  javaEchoue?: boolean;
}) {
  const base = mkdtempSync(join(tmpdir(), "gd-egg-"));
  dossiers.push(base);
  const racine = join(base, "serveur");
  const bin = join(base, "bin");
  mkdirSync(racine, { recursive: true });
  mkdirSync(bin);
  for (const [chemin, contenu] of Object.entries(options.avant ?? {})) {
    mkdirSync(dirname(join(racine, chemin)), { recursive: true });
    writeFileSync(join(racine, chemin), contenu);
  }

  const journal = join(base, "curl.log");
  outil(bin, "apt-get", "exit 0");
  // `curl … -o <fichier> <adresse>` : l'adresse est notée, un faux jar écrit.
  outil(
    bin,
    "curl",
    `sortie=""; adresse=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) sortie="$2"; shift 2 ;;
    -*) shift ;;
    *) adresse="$1"; shift ;;
  esac
done
echo "$adresse" >> "${journal}"
if [ -n "$sortie" ]; then echo "installeur" > "$sortie"; fi`,
  );
  const crees = (options.installe ?? [])
    .map((f) => `mkdir -p "$(dirname "${f}")"; echo x > "${f}"`)
    .join("\n");
  outil(bin, "java", options.javaEchoue ? "echo 'Java absent' >&2; exit 1" : crees);

  const result = spawnSync("bash", [SCRIPT], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      GD_RACINE_ESSAI: racine,
      ...options.env,
    },
    encoding: "utf8",
  });
  const lire = (chemin: string) =>
    existsSync(join(racine, chemin)) ? readFileSync(join(racine, chemin), "utf8") : null;
  return {
    code: result.status,
    sortie: `${result.stdout}${result.stderr}`,
    adresses: existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n") : [],
    lire,
  };
}

describe.skipIf(!BASH)("egg Minecraft Java : pose de Forge et NeoForge", () => {
  it("Forge récent : installeur officiel, et les arguments de la version installée", () => {
    const run = jouer({
      env: { LOADER: "forge", LOADER_VERSION: "47.3.0", MINECRAFT_VERSION: "1.20.1" },
      avant: {
        // L'ancienne version du pack : ses bibliothèques restent sur le disque.
        "libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt": "ancien",
        "mods/create.jar": "mod du pack",
      },
      installe: ["libraries/net/minecraftforge/forge/1.20.1-47.3.0/unix_args.txt"],
    });

    expect(run.code, run.sortie).toBe(0);
    expect(run.adresses).toEqual([
      "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-installer.jar",
    ]);
    // Régression : le premier unix_args.txt trouvé relançait l'ancienne version.
    expect(run.lire("gd-run.sh")).toContain(
      "@libraries/net/minecraftforge/forge/1.20.1-47.3.0/unix_args.txt nogui",
    );
    expect(run.lire("mods/create.jar")).toBe("mod du pack");
    expect(run.lire("forge-installer.jar")).toBeNull();
  });

  it("Forge ancien : l'artefact suffixé, puis le jar universel", () => {
    const run = jouer({
      env: {
        LOADER: "forge",
        LOADER_VERSION: "10.13.4.1614-1.7.10",
        MINECRAFT_VERSION: "1.7.10",
      },
      avant: {
        // Un Forge 1.20 installé avant : ses arguments ne doivent pas servir.
        "libraries/net/minecraftforge/forge/1.20.1-47.3.0/unix_args.txt": "autre",
      },
      installe: ["forge-1.7.10-10.13.4.1614-1.7.10-universal.jar"],
    });

    expect(run.code, run.sortie).toBe(0);
    expect(run.adresses).toEqual([
      "https://maven.minecraftforge.net/net/minecraftforge/forge/1.7.10-10.13.4.1614-1.7.10/forge-1.7.10-10.13.4.1614-1.7.10-installer.jar",
    ]);
    expect(run.lire("gd-run.sh")).toContain(
      "-jar forge-1.7.10-10.13.4.1614-1.7.10-universal.jar nogui",
    );
    expect(run.lire("gd-run.sh")).not.toContain("unix_args");
  });

  it("Forge 1.16 : le jar sans suffixe", () => {
    const run = jouer({
      env: { LOADER: "forge", LOADER_VERSION: "36.2.39", MINECRAFT_VERSION: "1.16.5" },
      installe: ["forge-1.16.5-36.2.39.jar"],
    });
    expect(run.code, run.sortie).toBe(0);
    expect(run.lire("gd-run.sh")).toContain("-jar forge-1.16.5-36.2.39.jar nogui");
  });

  it("NeoForge : son dépôt et ses arguments", () => {
    const run = jouer({
      env: { LOADER: "neoforge", LOADER_VERSION: "21.1.77", MINECRAFT_VERSION: "1.21.1" },
      installe: ["libraries/net/neoforged/neoforge/21.1.77/unix_args.txt"],
    });

    expect(run.code, run.sortie).toBe(0);
    expect(run.adresses).toEqual([
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.77/neoforge-21.1.77-installer.jar",
    ]);
    expect(run.lire("gd-run.sh")).toContain(
      "@libraries/net/neoforged/neoforge/21.1.77/unix_args.txt nogui",
    );
  });

  it("NeoForge 1.20.1 : l'ancien artefact forge de son dépôt", () => {
    const run = jouer({
      env: { LOADER: "neoforge", LOADER_VERSION: "47.1.106", MINECRAFT_VERSION: "1.20.1" },
      installe: ["libraries/net/neoforged/forge/1.20.1-47.1.106/unix_args.txt"],
    });

    expect(run.code, run.sortie).toBe(0);
    expect(run.adresses).toEqual([
      "https://maven.neoforged.net/releases/net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar",
    ]);
    expect(run.lire("gd-run.sh")).toContain(
      "@libraries/net/neoforged/forge/1.20.1-47.1.106/unix_args.txt nogui",
    );
  });

  it("un installeur qui échoue arrête le script, nomme la cause et ne réécrit pas le démarrage", () => {
    const run = jouer({
      env: { LOADER: "forge", LOADER_VERSION: "47.3.0", MINECRAFT_VERSION: "1.20.1" },
      avant: { "gd-run.sh": "ancien démarrage", "mods/create.jar": "mod du pack" },
      javaEchoue: true,
    });

    expect(run.code).not.toBe(0);
    expect(run.sortie).toContain("ÉCHEC : l'installeur Forge a échoué.");
    expect(run.lire("gd-run.sh")).toBe("ancien démarrage");
    expect(run.lire("mods/create.jar")).toBe("mod du pack");
  });

  it("un autre chargeur n'hérite pas des arguments laissés par Forge", () => {
    const run = jouer({
      env: { LOADER: "purpur", LOADER_VERSION: "latest", MINECRAFT_VERSION: "1.21.1" },
      avant: { "libraries/net/minecraftforge/forge/1.20.1-47.3.0/unix_args.txt": "forge" },
    });

    expect(run.code, run.sortie).toBe(0);
    expect(run.lire("gd-run.sh")).toContain("-jar server.jar nogui");
    expect(run.lire("gd-run.sh")).not.toContain("unix_args");
  });
});
