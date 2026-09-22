import { describe, expect, it } from "vitest";
import {
  parseConfigFiles,
  parseStartupConfiguration,
  parseStopConfiguration,
  resolveServerTokens,
} from "./remote-server.service";

/**
 * La commande d'arrêt décide comment un serveur de jeu se termine. Une erreur
 * ici ne se voit pas au démarrage : elle se découvre le jour où un serveur est
 * tué au lieu d'être arrêté proprement, c'est-à-dire le jour où un client perd
 * la dernière sauvegarde de son monde.
 */
describe("parseStopConfiguration", () => {
  it("traduit une commande console", () => {
    // Le cas Minecraft : la console reçoit « stop » et le serveur sauvegarde
    // avant de se terminer.
    expect(parseStopConfiguration("stop")).toEqual({ type: "command", value: "stop" });
  });

  it("traduit un signal, reconnaissable à son accent circonflexe", () => {
    expect(parseStopConfiguration("^SIGTERM")).toEqual({ type: "signal", value: "SIGTERM" });
    expect(parseStopConfiguration("^C")).toEqual({ type: "signal", value: "C" });
  });

  it("retombe sur SIGTERM quand l'egg n'indique rien", () => {
    // Sans valeur, Wings ne saurait pas comment arrêter le serveur. SIGTERM
    // laisse au processus l'occasion de se terminer proprement, contrairement
    // à un SIGKILL.
    expect(parseStopConfiguration(null)).toEqual({ type: "signal", value: "SIGTERM" });
    expect(parseStopConfiguration("")).toEqual({ type: "signal", value: "SIGTERM" });
  });

  it("ne confond pas une commande contenant un accent circonflexe", () => {
    // Seul le préfixe compte : « echo ^ » reste une commande.
    expect(parseStopConfiguration("echo ^")).toEqual({ type: "command", value: "echo ^" });
  });

  it("produit toujours un objet, jamais une chaîne", () => {
    // Wings désérialise `{type, value}` : une chaîne nue le laisserait avec un
    // type vide, donc sans savoir quoi faire à l'arrêt.
    for (const value of ["stop", "^SIGINT", null, ""]) {
      const parsed = parseStopConfiguration(value);
      expect(typeof parsed).toBe("object");
      expect(parsed.type).toMatch(/^(command|signal)$/);
      expect(parsed.value.length).toBeGreaterThan(0);
    }
  });
});

describe("parseStartupConfiguration", () => {
  it("met une détection écrite en chaîne dans un tableau", () => {
    /*
     * Relevé sur un vrai daemon : les eggs Pterodactyl écrivent souvent
     * `{"done": ")! For help, type "}`. Passé tel quel, Wings refuse la
     * réponse — « cannot unmarshal string into Go struct field
     * .process_configuration.startup.done of type []*remote.OutputLineMatcher »
     * — et la création du serveur meurt sur un 500 dont le panel ne dit rien.
     */
    expect(parseStartupConfiguration({ done: ")! For help, type " }).done).toEqual([
      ")! For help, type ",
    ]);
  });

  it("laisse un tableau tel quel", () => {
    expect(parseStartupConfiguration({ done: ["Done (", "For help"] }).done).toEqual([
      "Done (",
      "For help",
    ]);
  });

  it("rend un tableau vide plutôt qu'un marqueur inventé", () => {
    // Wings considère alors le serveur démarré dès que le processus tourne.
    // Inventer un marqueur ferait attendre un message qui ne viendra jamais.
    expect(parseStartupConfiguration({}).done).toEqual([]);
    expect(parseStartupConfiguration(null).done).toEqual([]);
    expect(parseStartupConfiguration({ done: "" }).done).toEqual([]);
  });

  it("accepte les deux graphies d'interaction utilisateur", () => {
    // Celle de Pterodactyl et celle que produisent certains exportateurs.
    expect(parseStartupConfiguration({ user_interaction: ["oui"] }).user_interaction).toEqual([
      "oui",
    ]);
    expect(parseStartupConfiguration({ userInteraction: "oui" }).user_interaction).toEqual(["oui"]);
  });

  it("écarte ce qui n'est pas une chaîne dans un tableau", () => {
    // Un egg importé d'un dépôt tiers n'est pas une source de confiance : une
    // entrée numérique ferait échouer la désérialisation côté daemon.
    expect(parseStartupConfiguration({ done: ["ok", 42, null] }).done).toEqual(["ok"]);
  });

  it("rend toujours les trois champs, au bon type", () => {
    for (const value of [null, {}, { done: "x" }, { done: ["x"], strip_ansi: true }]) {
      const parsed = parseStartupConfiguration(value);
      expect(Array.isArray(parsed.done)).toBe(true);
      expect(Array.isArray(parsed.user_interaction)).toBe(true);
      expect(typeof parsed.strip_ansi).toBe("boolean");
    }
  });
});

/**
 * La traduction qui empêchait de jouer.
 *
 * Le panel envoyait une liste vide, Wings ne réécrivait jamais
 * `server.properties`, et le serveur écoutait 25565 pendant que le conteneur
 * publiait le port de l'allocation. Aucun journal ne disait rien : c'est
 * exactement le genre de défaut qu'un test doit tenir en place.
 */
describe("parseConfigFiles", () => {
  const PAPER = {
    "server.properties": {
      parser: "properties",
      find: {
        "server-ip": "0.0.0.0",
        "server-port": "{{server.build.default.port}}",
        "query.port": "{{server.build.default.port}}",
      },
    },
  };

  it("traduit la forme objet des eggs en tableau pour Wings", () => {
    const [file] = parseConfigFiles(PAPER, { build: { default: { port: 25566 } } });

    expect(file?.file).toBe("server.properties");
    expect(file?.parser).toBe("properties");
    // Le port est **résolu ici** : Wings recopierait le gabarit tel quel.
    expect(file?.replace).toContainEqual({ match: "server-port", replace_with: "25566" });
  });

  it("traduit un remplacement conditionnel en if_value", () => {
    // « si tu trouves 127.0.0.1, mets 0.0.0.0 » — la forme que Pterodactyl
    // emploie pour ne pas écraser une valeur déjà correcte.
    const [file] = parseConfigFiles({
      "server.properties": {
        parser: "properties",
        find: { "server-ip": { "127.0.0.1": "0.0.0.0" } },
      },
    });

    expect(file?.replace).toEqual([
      { match: "server-ip", if_value: "127.0.0.1", replace_with: "0.0.0.0" },
    ]);
  });

  it("laisse passer un egg déjà au format du daemon", () => {
    const already = [
      { file: "a.yml", parser: "yaml", replace: [{ match: "x", replace_with: "y" }] },
    ];
    expect(parseConfigFiles(already)).toEqual(already);
  });

  it("écarte ce qui est mal formé plutôt que de l'envoyer au daemon", () => {
    // Une règle bâtie de travers ferait échouer la désérialisation de toute la
    // configuration, et le serveur ne démarrerait plus du tout.
    expect(parseConfigFiles(null)).toEqual([]);
    expect(parseConfigFiles("server.properties")).toEqual([]);
    expect(parseConfigFiles({ "a.txt": { parser: "properties" } })).toEqual([]);
    expect(parseConfigFiles({ "a.txt": { find: { k: 42 } } })).toEqual([]);
  });

  it("suppose « properties » quand l'egg ne déclare pas d'analyseur", () => {
    const [file] = parseConfigFiles({ "a.txt": { find: { k: "v" } } });
    expect(file?.parser).toBe("properties");
  });
});

/**
 * Wings ne résout que `{{config.*}}`, sa propre configuration. Tout ce qui
 * commence par `server.` est au panel de le remplir — sans quoi le fichier
 * reçoit le gabarit en toutes lettres.
 */
describe("resolveServerTokens", () => {
  const CONTEXT = {
    uuid: "abc",
    build: { default: { ip: "0.0.0.0", port: 25566 }, env: { SERVER_JARFILE: "server.jar" } },
  };

  it("remplit le port de l'allocation", () => {
    expect(resolveServerTokens("{{server.build.default.port}}", CONTEXT)).toBe("25566");
  });

  it("atteint les variables d'environnement du serveur", () => {
    expect(resolveServerTokens("{{server.build.env.SERVER_JARFILE}}", CONTEXT)).toBe("server.jar");
  });

  it("laisse intacts les gabarits du daemon", () => {
    // `config.docker.interface` désigne la configuration de Wings, que le
    // panel ne connaît pas : y toucher écraserait une valeur que le daemon
    // sait remplir.
    expect(resolveServerTokens("{{config.docker.interface}}", CONTEXT)).toBe(
      "{{config.docker.interface}}",
    );
  });

  it("vide un gabarit introuvable plutôt que de le recopier", () => {
    // Une valeur vide se voit et se corrige ; un `{{…}}` recopié dans
    // server.properties s'y installe et déroute qui le lit en SFTP.
    expect(resolveServerTokens("{{server.build.env.ABSENT}}", CONTEXT)).toBe("");
  });

  it("remplit les gabarits jusque dans les règles d'un egg", () => {
    const [file] = parseConfigFiles(
      {
        "server.properties": {
          parser: "properties",
          find: { "server-port": "{{server.build.default.port}}" },
        },
      },
      CONTEXT,
    );

    expect(file?.replace).toEqual([{ match: "server-port", replace_with: "25566" }]);
  });
});
