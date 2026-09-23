import { describe, expect, it } from "vitest";
import {
  type EggDraft,
  eggChangeRefusals,
  eggDraftProblems,
  previewStartup,
  type StoredEggVariable,
} from "./egg-editor";
import { rulesProblem, validateVariableValue } from "./egg-rules";

/** Un brouillon valide, à abîmer champ par champ. */
function brouillon(overrides: Partial<EggDraft> = {}): EggDraft {
  return {
    name: "Paper",
    description: "",
    author: "",
    dockerImages: [{ label: "Java 21", image: "ghcr.io/pterodactyl/yolks:java_21" }],
    startup: "java -jar {{SERVER_JARFILE}}",
    configStop: "stop",
    configStartup: '{"done":"Done"}',
    configFiles: "{}",
    configLogs: "",
    installContainer: "debian:bookworm-slim",
    installEntrypoint: "bash",
    installScript: "#!/bin/bash",
    features: [],
    fileDenylist: [],
    variables: [
      {
        id: null,
        name: "Fichier",
        envVariable: "SERVER_JARFILE",
        description: "",
        defaultValue: "server.jar",
        userViewable: true,
        userEditable: true,
        rules: "required|string|max:40",
      },
    ],
    ...overrides,
  };
}

const codes = (input: unknown) => eggDraftProblems(input).map((p) => `${p.path}:${p.code}`);

describe("règles de validation écrites depuis l'éditeur", () => {
  it.each([
    "required|string",
    "nullable|integer|between:1,100",
    "required|in:vanilla,paper,fabric",
    "required|regex:/^[a-z|]+$/",
    "sometimes|boolean",
    "required|ipv4",
  ])("accepte « %s »", (rules) => {
    expect(rulesProblem(rules)).toBeNull();
  });

  it.each([
    ["", "rulesEmpty"],
    ["requird|string", "ruleUnknown"],
    ["required|digits:5", "ruleUnknown"],
    ["required|max:vingt", "ruleNeedsNumber"],
    ["required|between:1", "ruleNeedsTwoNumbers"],
    ["required|in:", "ruleInEmpty"],
    ["required|regex:/[a-z/", "ruleRegexInvalid"],
    ["required|regex:abc", "ruleRegexInvalid"],
  ])("refuse « %s » (%s)", (rules, code) => {
    expect(rulesProblem(rules)?.code).toBe(code);
  });

  it("n'accepte que des règles que le panel applique ou sait sans effet", () => {
    // Cohérence avec l'applicateur : une règle acceptée à l'écriture doit
    // changer quelque chose (ou être explicitement neutre) à l'application.
    // `digits` est refusé plus haut précisément parce que `validateVariableValue`
    // l'ignorerait et laisserait passer « abc ».
    expect(validateVariableValue("required|digits:5", "abc")).toBeNull();
    expect(validateVariableValue("required|max:3", "abcd")).not.toBeNull();
  });
});

describe("brouillon d'egg", () => {
  it("accepte un brouillon complet", () => {
    expect(eggDraftProblems(brouillon())).toEqual([]);
  });

  it("rattache chaque défaut à son champ", () => {
    const variables = brouillon().variables;
    const input = brouillon({
      name: " ",
      dockerImages: [],
      configFiles: "{pas du json",
      variables: [
        { ...(variables[0] as EggDraft["variables"][number]), rules: "required|max:x" },
        {
          ...(variables[0] as EggDraft["variables"][number]),
          envVariable: "SERVER_PORT",
          rules: "required",
        },
      ],
    });
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        "name:required",
        "dockerImages:imagesEmpty",
        "configFiles:jsonObject",
        "variables.0.rules:ruleNeedsNumber",
        "variables.1.envVariable:envReserved",
      ]),
    );
  });

  it("refuse une valeur par défaut que ses propres règles rejettent", () => {
    const variable = brouillon().variables[0] as EggDraft["variables"][number];
    expect(
      codes(brouillon({ variables: [{ ...variable, defaultValue: "x".repeat(41) }] })),
    ).toEqual(["variables.0.defaultValue:defaultBreaksRules"]);
  });

  it("refuse une variable modifiable mais invisible", () => {
    const variable = brouillon().variables[0] as EggDraft["variables"][number];
    expect(codes(brouillon({ variables: [{ ...variable, userViewable: false }] }))).toEqual([
      "variables.0.userEditable:editableHidden",
    ]);
  });

  it("refuse deux variables du même nom et deux images du même libellé", () => {
    const variable = brouillon().variables[0] as EggDraft["variables"][number];
    const image = { label: "Java", image: "a" };
    expect(
      codes(brouillon({ variables: [variable, variable], dockerImages: [image, image] })),
    ).toEqual(["dockerImages.1.label:duplicate", "variables.1.envVariable:duplicate"]);
  });
});

describe("changements sur un egg employé par des serveurs", () => {
  const PORT_JEU: StoredEggVariable = {
    id: "00000000-0000-4000-8000-000000000001",
    envVariable: "GAME_PORT",
    rules: "required|integer",
    defaultValue: "27015",
    serverValues: ["27015", "27016"],
  };
  const INUTILE: StoredEggVariable = {
    id: "00000000-0000-4000-8000-000000000002",
    envVariable: "OLD_FLAG",
    rules: "nullable|string",
    defaultValue: "",
    serverValues: [],
  };
  const inchangee = (v: StoredEggVariable) => ({
    id: v.id,
    envVariable: v.envVariable,
    rules: v.rules,
    defaultValue: v.defaultValue,
  });

  it("refuse de supprimer une variable employée, en donnant le nombre de serveurs", () => {
    expect(eggChangeRefusals([PORT_JEU, INUTILE], [inchangee(INUTILE)], 2)).toEqual([
      { code: "variableInUseRemoved", envVariable: "GAME_PORT", servers: 2 },
    ]);
  });

  it("laisse supprimer une variable que personne n'emploie", () => {
    expect(eggChangeRefusals([PORT_JEU, INUTILE], [inchangee(PORT_JEU)], 2)).toEqual([]);
  });

  it("refuse de renommer une variable employée", () => {
    const renommee = { ...inchangee(PORT_JEU), envVariable: "PORT" };
    expect(eggChangeRefusals([PORT_JEU], [renommee], 2)[0]?.code).toBe("variableInUseRenamed");
  });

  it("refuse de rendre obligatoire une variable sans valeur par défaut", () => {
    const durcie = { ...inchangee(INUTILE), rules: "required|string" };
    expect(eggChangeRefusals([INUTILE], [durcie], 3)).toEqual([
      { code: "requiredWithoutDefault", envVariable: "OLD_FLAG", servers: 3 },
    ]);
  });

  it("refuse d'ajouter une variable obligatoire vide à un egg employé", () => {
    const nouvelle = { id: null, envVariable: "TOKEN", rules: "required|string", defaultValue: "" };
    expect(eggChangeRefusals([], [nouvelle], 1)[0]?.code).toBe("requiredWithoutDefault");
    // Sur un egg que personne n'emploie, c'est le choix de l'auteur.
    expect(eggChangeRefusals([], [nouvelle], 0)).toEqual([]);
  });

  it("refuse des règles que des valeurs déjà posées ne respectent plus", () => {
    const durcie = { ...inchangee(PORT_JEU), rules: "required|integer|max:27015" };
    expect(eggChangeRefusals([PORT_JEU], [durcie], 2)).toEqual([
      { code: "valuesBreakRules", envVariable: "GAME_PORT", servers: 1 },
    ]);
  });

  it("n'examine pas une variable qu'on n'a pas touchée", () => {
    // Un egg importé porte parfois une variable obligatoire vide : corriger
    // sa description ne doit pas obliger à réparer ce qu'on n'a pas touché.
    const heritee: StoredEggVariable = { ...INUTILE, rules: "required|string" };
    expect(eggChangeRefusals([heritee], [inchangee(heritee)], 5)).toEqual([]);
  });

  it("refuse un identifiant de variable qui n'appartient pas à l'egg", () => {
    const etrangere = { ...inchangee(PORT_JEU), id: "00000000-0000-4000-8000-00000000abcd" };
    expect(eggChangeRefusals([PORT_JEU], [inchangee(PORT_JEU), etrangere], 2)[0]?.code).toBe(
      "unknownVariable",
    );
  });
});

describe("aperçu de la commande de démarrage", () => {
  it("remplace les variables connues et laisse le reste en place", () => {
    const variables = [{ envVariable: "SERVER_JARFILE", defaultValue: "server.jar" }];
    // La forme shell `${VAR}` est aussi reconnue ; écrite par morceaux pour
    // qu'on ne la prenne pas pour un gabarit JavaScript oublié.
    const shell = ["$", "{SERVER_JARFILE}"].join("");
    expect(
      previewStartup(`java -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} ${shell}`, variables),
    ).toBe("java -Xmx{{SERVER_MEMORY}}M -jar server.jar server.jar");
  });
});
