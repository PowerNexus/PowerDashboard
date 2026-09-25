import { type Database, eggs, serverHealth, servers } from "@gamedashboard/db";
import { BadRequestException, Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ServerPlayersService } from "./server-players.service";

/**
 * Vue joueurs : ce que la page lit, et les commandes qu'elle fabrique.
 *
 * La sonde de jeu jetait les noms des joueurs (`players.sample`), et aucune
 * commande de modération n'était déclarée nulle part : on ne pouvait ni voir
 * qui était connecté, ni l'expulser sans taper la commande à la main.
 */
describe.skipIf(!HAS_DATABASE)("vue joueurs (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let serverId: string;
  let service: ServerPlayersService;

  const eggDuServeur = async () =>
    (await db.select({ id: servers.eggId }).from(servers).where(eq(servers.id, serverId)))[0]?.id ??
    "";
  const sonde = (payload: Record<string, unknown>, ilYA = "30 seconds", reachable = true) =>
    db.insert(serverHealth).values({
      serverId,
      reachable,
      queryPayload: payload,
      at: sql`now() - ${ilYA}::interval` as unknown as string,
    });

  beforeAll(async () => {
    Logger.overrideLogger(false);
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        "truncate table server_health, servers, allocations, eggs, nests, nodes, locations, users cascade",
      ),
    );
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    serverId = await seedServer(db, { nodeId, ownerId: await seedUser(db) });
    service = new ServerPlayersService(db);
  });

  it("lit la dernière sonde joignable, avec son échantillon", async () => {
    await db
      .update(eggs)
      .set({ name: "Minecraft Java" })
      .where(eq(eggs.id, await eggDuServeur()));
    await sonde({ playersOnline: 1, playersMax: 20, sample: ["Alex"] }, "2 minutes");
    await sonde({ playersOnline: 2, playersMax: 20, sample: ["Steve", "Alex"] });
    await sonde({}, "10 seconds", false);

    const vue = await service.view(serverId);

    expect(vue).toMatchObject({ online: 2, max: 20, sample: ["Steve", "Alex"], complete: true });
    expect(vue.observedAt).not.toBeNull();
    expect(vue.actions).toEqual([
      "kick",
      "ban",
      "pardon",
      "whitelist_add",
      "whitelist_remove",
      "op",
      "deop",
    ]);
  });

  it("dit que l'échantillon est partiel, et ne lit pas une sonde trop ancienne", async () => {
    await sonde({ playersOnline: 30, playersMax: 50, sample: ["Steve"] });
    expect(await service.view(serverId)).toMatchObject({ online: 30, complete: false });

    await db.execute(sql.raw("truncate table server_health"));
    await sonde({ playersOnline: 30, playersMax: 50, sample: ["Steve"] }, "1 hour");
    expect(await service.view(serverId)).toMatchObject({
      online: null,
      sample: null,
      observedAt: null,
    });
  });

  it("ne propose rien pour un jeu inconnu qui ne déclare pas de commande", async () => {
    const vue = await service.view(serverId);
    expect(vue.actions).toEqual([]);
    await expect(service.command(serverId, "kick", "Steve", undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("préfère les commandes déclarées par l'egg", async () => {
    await db
      .update(eggs)
      .set({ playerCommands: { kick: "kick {player} {reason}", ban: "banid {player}" } })
      .where(eq(eggs.id, await eggDuServeur()));

    expect((await service.view(serverId)).actions).toEqual(["kick", "ban"]);
    expect(await service.command(serverId, "ban", "Steve", "ignoré")).toEqual({
      action: "ban",
      player: "Steve",
      command: "banid Steve",
    });
    expect((await service.command(serverId, "kick", "Steve", "Triche")).command).toBe(
      "kick Steve Triche",
    );
  });

  it("refuse un nom qui ajouterait une commande, et une action inconnue", async () => {
    await db
      .update(eggs)
      .set({ name: "Paper" })
      .where(eq(eggs.id, await eggDuServeur()));

    await expect(service.command(serverId, "kick", "x\nop x", undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.command(serverId, "stop", "Steve", undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
