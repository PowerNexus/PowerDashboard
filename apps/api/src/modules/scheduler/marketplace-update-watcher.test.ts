import { describe, expect, it, vi } from "vitest";
import type { EngineService } from "../marketplace/engine.service";
import type { MarketplaceService, UpdateFound } from "../marketplace/marketplace.service";
import type { NotificationsService } from "../notifications/notifications.service";
import {
  MarketplaceUpdateWatcherService,
  packUpdateBody,
  packUpdateTitle,
  updatesBody,
  updatesTitle,
} from "./marketplace-update-watcher.service";

describe("veille des mises à jour : notification", () => {
  it("prévient le propriétaire de chaque serveur concerné, une fois", async () => {
    const found = new Map<string, UpdateFound[]>([
      ["srv-1", [{ name: "EssentialsX", version: "2.22.0" }]],
    ]);
    const marketplace = { checkUpdates: vi.fn(async () => found) };
    const notifications = { notifyServerOwner: vi.fn(async () => {}) };
    const engine = { checkPackUpdates: vi.fn(async () => new Map()) };
    const veille = new MarketplaceUpdateWatcherService(
      marketplace as unknown as MarketplaceService,
      notifications as unknown as NotificationsService,
      engine as unknown as EngineService,
    );

    await veille.tick();

    expect(notifications.notifyServerOwner).toHaveBeenCalledTimes(1);
    expect(notifications.notifyServerOwner).toHaveBeenCalledWith("srv-1", {
      type: "marketplace.update_available",
      title: "Une mise à jour d'extension est disponible",
      body: "EssentialsX 2.22.0. À installer depuis la page Extensions du serveur.",
      level: "info",
    });
  });

  it("borne la liste à cinq noms", () => {
    const updates = Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, version: "1" }));
    expect(updatesTitle(updates)).toBe("7 mises à jour d'extensions sont disponibles");
    expect(updatesBody(updates)).toMatch(/^P0 1, P1 1, P2 1, P3 1, P4 1 et 2 autre\(s\)\./);
  });

  it("prévient aussi d'une nouvelle version du modpack installé", async () => {
    const marketplace = { checkUpdates: vi.fn(async () => new Map()) };
    const notifications = { notifyServerOwner: vi.fn(async () => {}) };
    const engine = {
      checkPackUpdates: vi.fn(
        async () => new Map([["srv-2", [{ name: "Better MC", version: "v42 · 1.20.1" }]]]),
      ),
    };
    const veille = new MarketplaceUpdateWatcherService(
      marketplace as unknown as MarketplaceService,
      notifications as unknown as NotificationsService,
      engine as unknown as EngineService,
    );

    await veille.tick();

    expect(engine.checkPackUpdates).toHaveBeenCalledWith(100, "24 hours");
    expect(notifications.notifyServerOwner).toHaveBeenCalledWith("srv-2", {
      type: "marketplace.update_available",
      title: packUpdateTitle([{ name: "Better MC", version: "v42 · 1.20.1" }]),
      body: packUpdateBody([{ name: "Better MC", version: "v42 · 1.20.1" }]),
      level: "info",
    });
    expect(packUpdateBody([{ name: "Better MC", version: "v42" }])).toMatch(/page Moteur/);
  });
});
