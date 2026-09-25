import { randomUUID } from "node:crypto";
import type { EggDraft } from "@gamedashboard/contracts";
import {
  allocations,
  type Database,
  eggs,
  eggVariables,
  servers,
  serverVariables,
} from "@gamedashboard/db";
import { ConflictException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { EggEditorService } from "./egg-editor.service";
import { EggImportService } from "./egg-import.service";

/**
 * Éditeur et export d'egg, contre une vraie base.
 *
 * Le test qui compte le plus est le premier : **export puis import redonnent
 * le même egg**. Il traverse tout ce qui peut perdre une information — les
 * colonnes jsonb, les tableaux, les variables et leurs drapeaux — et non le
 * seul format de fichier, que `contracts` éprouve déjà.
 */

/** Un export Pterodactyl complet, tel qu'on le colle dans l'écran d'import. */
const FICHIER = {
  meta: { version: "PTDL_v2" },
  name: "Valheim",
  author: "eggs@exemple.fr",
  description: "Serveur dédié Valheim",
  features: ["steam_disk_space"],
  docker_images: {
    Debian: "ghcr.io/parkervcp/yolks:debian",
    Proton: "ghcr.io/parkervcp/yolks:wine_latest",
  },
  file_denylist: ["*.bak"],
  startup: './valheim_server.x86_64 -name "{{SERVER_NAME}}" -port {{SERVER_PORT}}',
  config: {
    files: '{"adminlist.txt":{"parser":"file","find":{"0":"{{ADMIN}}"}}}',
    startup: '{"done":"Game server connected"}',
    logs: "{}",
    stop: "^C",
  },
  scripts: {
    installation: {
      script: "#!/bin/bash\n# « é »\nsteamcmd +quit\n",
      container: "ghcr.io/parkervcp/installers:debian",
      entrypoint: "bash",
    },
  },
  variables: [
    {
      name: "Nom du serveur",
      description: "Affiché dans la liste des serveurs",
      env_variable: "SERVER_NAME",
      default_value: "Mon serveur",
      user_viewable: true,
      user_editable: true,
      rules: "required|string|max:64",
    },
    {
      name: "Mot de passe",
      description: "",
      env_variable: "SERVER_PASSWORD",
      default_value: "secret",
      user_viewable: false,
      user_editable: false,
      rules: "nullable|string|between:5,32",
    },
  ],
};

describe.skipIf(!HAS_DATABASE)("EggEditorService (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let editor: EggEditorService;
  let importer: EggImportService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    editor = new EggEditorService(db);
    importer = new EggImportService(db);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw("truncate table servers, allocations, eggs, nests, nodes, locations, users cascade"),
    );
  });

  /** Un serveur qui emploie l'egg, avec une valeur posée pour chacune de ses variables. */
  async function serveurSur(eggId: string, valeurs: Record<string, string> = {}) {
    const node = await seedNode(db, { locationId: await seedLocation(db) });
    const [allocation] = await db
      .insert(allocations)
      .values({ nodeId: node, ip: "127.0.0.1", port: 25_000 + Math.floor(Math.random() * 5000) })
      .returning({ id: allocations.id });
    const id = randomUUID();
    await db.insert(servers).values({
      id,
      uuidShort: id.slice(0, 8),
      name: "Serveur",
      ownerId: await seedUser(db),
      nodeId: node,
      eggId,
      allocationId: allocation?.id ?? "",
      dockerImage: "ghcr.io/parkervcp/yolks:debian",
      startup: FICHIER.startup,
      memoryMb: 2048,
      diskMb: 10_240,
    });
    const declarees = await db.select().from(eggVariables).where(eq(eggVariables.eggId, eggId));
    for (const variable of declarees) {
      await db.insert(serverVariables).values({
        serverId: id,
        eggVariableId: variable.id,
        value: valeurs[variable.envVariable] ?? variable.defaultValue,
      });
    }
    return id;
  }

  /** Le brouillon que l'écran enverrait pour l'egg tel qu'il est. */
  async function brouillon(eggId: string): Promise<EggDraft> {
    const egg = await editor.detail(eggId);
    return {
      name: egg.name,
      description: egg.description ?? "",
      author: egg.author ?? "",
      dockerImages: Object.entries(egg.dockerImages).map(([label, image]) => ({ label, image })),
      startup: egg.startup,
      configStop: egg.configStop ?? "",
      configStartup: JSON.stringify(egg.configStartup),
      configFiles: JSON.stringify(egg.configFiles),
      configLogs: JSON.stringify(egg.configLogs),
      installContainer: egg.installContainer,
      installEntrypoint: egg.installEntrypoint,
      installScript: egg.installScript,
      features: egg.features,
      fileDenylist: egg.fileDenylist,
      consoleCommands: egg.consoleCommands,
      variables: egg.variables.map((v) => ({
        id: v.id,
        name: v.name,
        envVariable: v.envVariable,
        description: v.description ?? "",
        defaultValue: v.defaultValue,
        userViewable: v.userViewable,
        userEditable: v.userEditable,
        rules: v.rules,
      })),
    };
  }

  /** Ce qui définit un egg, sans ce qui est propre à la ligne (identifiants, dates). */
  async function contenu(eggId: string) {
    const {
      id: _id,
      nest: _nest,
      enabled: _enabled,
      locallyModified: _local,
      sourceRef: _ref,
      servers: _servers,
      variables,
      ...egg
    } = await editor.detail(eggId);
    return {
      ...egg,
      variables: variables.map(({ id: _v, servers: _s, ...variable }) => variable),
    };
  }

  it("redonne le même egg après export puis import", async () => {
    const { id: origine } = await importer.importOne({ json: FICHIER, nestName: "Survie" });

    const { filename, egg: fichier } = await editor.export(origine);
    expect(filename).toBe("egg-valheim.json");

    // Réimporté dans une autre famille : sinon l'import reconnaîtrait l'egg
    // par son nom et le réécrirait sur lui-même, ce qui ne prouverait rien.
    const { id: copie } = await importer.importOne({
      json: JSON.parse(JSON.stringify(fichier)),
      nestName: "Copies",
    });

    expect(copie).not.toBe(origine);
    expect(await contenu(copie)).toEqual(await contenu(origine));
    expect((await contenu(copie)).variables).toHaveLength(2);
  });

  it("redonne le même egg après une modification dans l'éditeur", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    const modifie = await brouillon(id);
    modifie.startup = "./valheim -name {{SERVER_NAME}}";
    modifie.configLogs = '{"custom":true}';
    modifie.variables.push({
      id: null,
      name: "Monde",
      envVariable: "WORLD",
      description: "",
      defaultValue: "Dedicated",
      userViewable: true,
      userEditable: true,
      rules: "required|alpha_dash",
    });
    await editor.update(id, modifie);

    const { egg: fichier } = await editor.export(id);
    const { id: copie } = await importer.importOne({ json: fichier, nestName: "Copies" });
    expect(await contenu(copie)).toEqual(await contenu(id));
    expect((await contenu(copie)).configLogs).toEqual({ custom: true });
  });

  it("marque l'egg modifié localement, pour que la synchronisation ne l'écrase pas", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    await editor.update(id, { ...(await brouillon(id)), name: "Valheim (épinglé)" });

    const [ligne] = await db.select().from(eggs).where(eq(eggs.id, id));
    expect(ligne?.locallyModified).toBe(true);
    expect(ligne?.name).toBe("Valheim (épinglé)");
  });

  it("refuse de supprimer une variable employée par un serveur", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    await serveurSur(id);

    const sansMotDePasse = await brouillon(id);
    sansMotDePasse.variables = sansMotDePasse.variables.filter(
      (v) => v.envVariable !== "SERVER_PASSWORD",
    );

    const refus = editor.update(id, sansMotDePasse);
    await expect(refus).rejects.toBeInstanceOf(ConflictException);
    await expect(refus).rejects.toThrow(/SERVER_PASSWORD.*1 serveur/);

    // Rien n'a bougé : ni la variable, ni la valeur du serveur.
    const detail = await editor.detail(id);
    expect(detail.variables.map((v) => v.envVariable)).toContain("SERVER_PASSWORD");
    expect(detail.variables.find((v) => v.envVariable === "SERVER_PASSWORD")?.servers).toBe(1);
  });

  it("laisse supprimer une variable sur un egg que personne n'emploie", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    const sansMotDePasse = await brouillon(id);
    sansMotDePasse.variables = sansMotDePasse.variables.filter(
      (v) => v.envVariable !== "SERVER_PASSWORD",
    );

    const rapport = await editor.update(id, sansMotDePasse);
    expect(rapport.variablesRemoved).toEqual(["SERVER_PASSWORD"]);
    expect(rapport.detail.variables).toHaveLength(1);
  });

  it("refuse des règles que la valeur d'un serveur ne respecterait plus", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    await serveurSur(id, { SERVER_NAME: "Un nom un peu long pour la nouvelle règle" });

    const durci = await brouillon(id);
    const nom = durci.variables.find((v) => v.envVariable === "SERVER_NAME");
    if (nom) nom.rules = "required|string|max:12";
    if (nom) nom.defaultValue = "Court";

    await expect(editor.update(id, durci)).rejects.toThrow(/refuseraient.*1 serveur/);
  });

  it("pose la valeur par défaut d'une variable ajoutée sur les serveurs existants", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    const serveur = await serveurSur(id);

    const avecMonde = await brouillon(id);
    avecMonde.variables.push({
      id: null,
      name: "Monde",
      envVariable: "WORLD",
      description: "",
      defaultValue: "Dedicated",
      userViewable: true,
      userEditable: true,
      rules: "required|alpha_dash",
    });
    const rapport = await editor.update(id, avecMonde);
    expect(rapport.serverValuesAdded).toBe(1);

    // Sans cette valeur, `environmentFor` n'enverrait pas WORLD à Wings, et la
    // commande de démarrage garderait `{{WORLD}}` littéral.
    const valeurs = await db
      .select({ nom: eggVariables.envVariable, valeur: serverVariables.value })
      .from(serverVariables)
      .innerJoin(eggVariables, eq(serverVariables.eggVariableId, eggVariables.id))
      .where(eq(serverVariables.serverId, serveur));
    expect(valeurs).toContainEqual({ nom: "WORLD", valeur: "Dedicated" });
  });

  it("refuse d'ajouter une variable obligatoire sans valeur par défaut à un egg employé", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    await serveurSur(id);

    const avecJeton = await brouillon(id);
    avecJeton.variables.push({
      id: null,
      name: "Jeton",
      envVariable: "TOKEN",
      description: "",
      defaultValue: "",
      userViewable: true,
      userEditable: true,
      rules: "required|string",
    });
    await expect(editor.update(id, avecJeton)).rejects.toThrow(/TOKEN.*valeur par défaut/);
  });

  it("refuse un brouillon mal formé en disant quel champ corriger", async () => {
    const { id } = await importer.importOne({ json: FICHIER, nestName: "Survie" });
    const casse = await brouillon(id);
    const nom = casse.variables[0];
    if (nom) nom.rules = "required|max:vingt";

    await expect(editor.update(id, casse)).rejects.toThrow(/variables\.0\.rules/);
  });
});

if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
