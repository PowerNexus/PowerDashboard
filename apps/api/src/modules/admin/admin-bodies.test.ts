import type { Database } from "@gamedashboard/db";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminController } from "./admin.controller";
import { AnnouncementsService } from "./announcements.service";

/**
 * Corps des routes d'administration : validés par schéma, et bornés
 * (rapport ASVS, NC-23).
 *
 * Nodes, localisations et rôle étaient lus champ par champ, par `typeof`, et
 * rien ne bornait le reste : un nom de node de plus de cent caractères ou
 * une image de conteneur de plus de 255 traversaient jusqu'à la colonne, qui
 * les refusait en erreur 500 ; une commande de démarrage ou le corps d'une
 * annonce acceptaient le mégaoctet entier que Fastify laisse passer.
 *
 * Ce qui compte ici : le refus est un 400 qui nomme le champ, et le service
 * n'est jamais appelé.
 */
const request = {
  user: { id: "admin-1", email: "admin@gamedashboard.test", role: "admin" },
  ip: "203.0.113.7",
  headers: {},
};

function controller() {
  const services = {
    infrastructure: { createNode: vi.fn(), createLocation: vi.fn() },
    actions: { setUserRole: vi.fn() },
    adminServers: { setRuntime: vi.fn() },
  };
  const instance = Object.create(AdminController.prototype) as AdminController;
  Object.assign(instance as unknown as Record<string, unknown>, services, {
    activityLog: { record: vi.fn() },
  });
  return { instance, services };
}

const node = {
  name: "FR-01",
  locationId: "7b0c8f7e-3f1a-4c7e-9a51-2f7d6d1c0b11",
  fqdn: "fr-01.gamedashboard.fr",
  memoryMb: 65_536,
  diskMb: 1_048_576,
  cpuCores: 16,
};

describe("corps des routes d'administration", () => {
  it.each([
    ["un nom au-delà de la colonne", { ...node, name: "n".repeat(101) }, "name"],
    ["une mémoire envoyée en texte", { ...node, memoryMb: "65536" }, "memoryMb"],
    ["un protocole inconnu", { ...node, scheme: "ftp" }, "scheme"],
    ["un port hors plage", { ...node, daemonPort: 70_000 }, "daemonPort"],
  ])("refuse un node avec %s", async (_, body, champ) => {
    const { instance, services } = controller();
    const refus = instance.createNode(request as never, body);
    await expect(refus).rejects.toBeInstanceOf(BadRequestException);
    await expect(refus).rejects.toThrow(champ);
    expect(services.infrastructure.createNode).not.toHaveBeenCalled();
  });

  it("déclare un node avec les défauts d'avant, un classement vide valant « non classé »", async () => {
    const { instance, services } = controller();
    services.infrastructure.createNode.mockResolvedValue({ id: "n", tokenId: "t", token: "s" });
    await instance.createNode(request as never, { ...node, category: "", subcategory: null });
    expect(services.infrastructure.createNode).toHaveBeenCalledWith({
      ...node,
      category: null,
      subcategory: null,
      scheme: "https",
      daemonPort: 8080,
      daemonSftpPort: 2022,
      isPublic: true,
    });
  });

  it("refuse une localisation dont le libellé dépasse la colonne", async () => {
    const { instance, services } = controller();
    const refus = instance.createLocation(request as never, {
      short: "PAR",
      long: "l".repeat(121),
      countryCode: "FR",
    });
    await expect(refus).rejects.toThrow(/long/);
    expect(services.infrastructure.createLocation).not.toHaveBeenCalled();
  });

  it("refuse un rôle hors du contrat", async () => {
    const { instance, services } = controller();
    await expect(
      instance.setUserRole(request as never, "cible", { role: "owner" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(services.actions.setUserRole).not.toHaveBeenCalled();
  });

  it.each([
    [
      "une image au-delà de la colonne",
      { dockerImage: `ghcr.io/${"i".repeat(250)}` },
      "dockerImage",
    ],
    ["une commande de démarrage démesurée", { startup: "x".repeat(10_001) }, "startup"],
  ])("refuse %s", async (_, body, champ) => {
    const { instance, services } = controller();
    const refus = instance.setServerRuntime(request as never, "srv", body);
    await expect(refus).rejects.toThrow(champ);
    expect(services.adminServers.setRuntime).not.toHaveBeenCalled();
  });

  it("borne le corps d'une annonce", async () => {
    // Refusé avant toute écriture : la base n'est pas jointe.
    const announcements = new AnnouncementsService({} as Database);
    await expect(
      announcements.save({ title: "Maintenance", bodyMd: "x".repeat(20_001) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
