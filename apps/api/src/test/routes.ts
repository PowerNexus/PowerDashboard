import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { AdminController } from "../modules/admin/admin.controller";
import { AdminNodesController } from "../modules/admin/admin-nodes.controller";
import { AdminUsersController } from "../modules/admin/admin-users.controller";
import { ApplicationKeysController } from "../modules/application/application-keys.controller";
import { WebhooksController } from "../modules/application/webhooks.controller";
import { IncidentsController } from "../modules/status/incidents.controller";

/**
 * Relevé des routes d'un contrôleur, pour les contrôles de couverture.
 *
 * Lu sur les métadonnées que Nest lit lui-même, et non tenu à la main : une
 * liste écrite une fois ne voit pas la route ajoutée ensuite, et c'est
 * précisément celle-là qu'on oublie de garder ou de consigner.
 */
export type Controller = abstract new (...args: never[]) => object;

export interface Route {
  controller: Controller;
  name: string;
  handler: (...args: unknown[]) => unknown;
  method: number;
}

/** Les contrôleurs montés sous `/api/v1/admin`. */
export const ADMIN_CONTROLLERS: readonly Controller[] = [
  AdminController,
  AdminNodesController,
  AdminUsersController,
  WebhooksController,
  ApplicationKeysController,
  IncidentsController,
];

export const WRITE_METHODS: ReadonlySet<number> = new Set<number>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

export function routesOf(controller: Controller): Route[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype).flatMap((name) => {
    const handler = prototype[name];
    if (name === "constructor" || typeof handler !== "function") return [];
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    return method === undefined
      ? []
      : [{ controller, name, handler: handler as Route["handler"], method }];
  });
}

/** Gardes effectifs : ceux du contrôleur, puis ceux de la méthode. */
export function guardsOf(route: Route): unknown[] {
  return [
    ...(Reflect.getMetadata(GUARDS_METADATA, route.controller) ?? []),
    ...(Reflect.getMetadata(GUARDS_METADATA, route.handler) ?? []),
  ];
}

export const routeLabel = (route: Route) => `${route.controller.name}.${route.name}`;
