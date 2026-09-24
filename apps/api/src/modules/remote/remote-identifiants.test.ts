import "reflect-metadata";
import { type WingsErrorResponse, wingsWillRetry } from "@gamedashboard/contracts";
import { type ExecutionContext, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerTransferService } from "../admin/server-transfer.service";
import { type NodeIdentity, NodeRepository } from "./node.repository";
import { NodeTokenGuard } from "./node-token.guard";
import { RemoteController } from "./remote.controller";
import { RemoteActivityService } from "./remote-activity.service";
import { RemoteBackupService } from "./remote-backup.service";
import { RemoteServerService } from "./remote-server.service";
import { SftpAuthService } from "./sftp-auth.service";

/**
 * Identifiants mal formés sur les routes du daemon (NC-24).
 *
 * `GET /api/remote/servers/pas-un-uuid` répondait **500** : l'identifiant
 * arrivait tel quel jusqu'à PostgreSQL, qui refusait la conversion en UUID.
 * Or Wings rejoue tout ce qui n'est pas un 4xx, avec temporisation — une
 * condition définitive devenait une boucle de tentatives.
 *
 * Le test passe par une vraie application Nest sur Fastify, pas par un appel
 * de méthode : le contrôle vit dans un pipe et la réponse dans un filtre, deux
 * étages qu'un appel direct du contrôleur contourne. Les services simulés
 * échouent comme la base réelle sur un identifiant illisible — c'est ce qui
 * produisait la 500.
 */

const NODE: NodeIdentity = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "RYZEN-09",
  tokenId: "node-abc",
  tokenSecret: "peu-importe",
  maintenanceMode: false,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ce que PostgreSQL répond à `eq(uuid, 'pas-un-uuid')`. */
function commeLaBase(...args: unknown[]): Promise<null> {
  const illisible = args.find((a) => typeof a === "string" && a !== NODE.id && !UUID.test(a));
  if (illisible !== undefined) {
    return Promise.reject(new Error(`invalid input syntax for type uuid: "${String(illisible)}"`));
  }
  return Promise.resolve(null);
}

const servers = {
  configuration: vi.fn(commeLaBase),
  configurationForTransfer: vi.fn(commeLaBase),
  installationScript: vi.fn(commeLaBase),
  markInstalled: vi.fn(commeLaBase),
};
const backups = { openUpload: vi.fn(commeLaBase), complete: vi.fn(commeLaBase) };
const transfers = {
  isTransferTarget: vi.fn(async (...args: unknown[]) => Boolean(await commeLaBase(...args))),
  complete: vi.fn(commeLaBase),
  fail: vi.fn(commeLaBase),
};

/** Les routes qui lisent `:uuid`, relevées sur le contrôleur lui-même. */
function routesAvecUuid(): { method: string; path: string }[] {
  const proto = RemoteController.prototype as unknown as Record<string, unknown>;
  const routes: { method: string; path: string }[] = [];

  for (const name of Object.getOwnPropertyNames(proto)) {
    const handler = proto[name];
    if (typeof handler !== "function" || name === "constructor") continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (path === undefined) continue;

    const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, RemoteController, name) ?? {}) as Record<
      string,
      { data?: unknown }
    >;
    if (!Object.values(args).some((arg) => arg.data === "uuid")) continue;

    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
    routes.push({ method: method ?? "GET", path });
  }
  return routes;
}

describe("routes du daemon : identifiant mal formé", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RemoteController],
      providers: [
        { provide: RemoteServerService, useValue: servers },
        { provide: NodeRepository, useValue: { recordHeartbeat: vi.fn(async () => {}) } },
        { provide: RemoteBackupService, useValue: backups },
        { provide: RemoteActivityService, useValue: { record: vi.fn(async () => {}) } },
        { provide: ServerTransferService, useValue: transfers },
        { provide: SftpAuthService, useValue: { authenticate: vi.fn(async () => null) } },
      ],
    })
      // Le jeton n'est pas le sujet : le node est posé comme le ferait la garde.
      .overrideGuard(NodeTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ node?: NodeIdentity }>().node = NODE;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trouve les routes à contrôler", () => {
    // Garde-fou du test lui-même : une liste vide le ferait passer sans rien
    // vérifier.
    expect(routesAvecUuid().length).toBeGreaterThanOrEqual(6);
  });

  it.each(routesAvecUuid())("$method $path : 400 définitif, au format de Wings", async (route) => {
    const url = `/api/remote/${route.path.replace(":uuid", "pas-un-uuid").replace(":state", "failure")}`;
    const response = await app.inject({
      method: route.method as "GET" | "POST",
      url,
      ...(route.method === "POST" ? { payload: {} } : {}),
    });

    expect(response.statusCode).toBe(400);
    expect(wingsWillRetry(response.statusCode)).toBe(false);

    // Le corps reste celui que le daemon sait lire (`remote/errors.go`) :
    // un 400 au format habituel du panel lui serait illisible.
    const body = response.json<WingsErrorResponse>();
    expect(body.errors[0]).toMatchObject({ status: "400", code: "BadRequestException" });

    // Et rien n'a atteint la base.
    for (const fn of [
      ...Object.values(servers),
      ...Object.values(backups),
      ...Object.values(transfers),
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("laisse passer un identifiant bien formé jusqu'au service", async () => {
    // Serveur inconnu : 404, comme avant. Le contrôle ne refuse que la forme.
    const response = await app.inject({
      method: "GET",
      url: "/api/remote/servers/22222222-2222-4222-8222-222222222222",
    });

    expect(response.statusCode).toBe(404);
    expect(servers.configuration).toHaveBeenCalledWith(
      NODE.id,
      "22222222-2222-4222-8222-222222222222",
    );
  });
});
