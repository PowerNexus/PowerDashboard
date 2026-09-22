import type { Database } from "@gamedashboard/db";
import { describe, expect, it, vi } from "vitest";
import type { NotificationsService } from "../notifications/notifications.service";
import type { QuotaUsageDetailed, ResellerQuotaService } from "../reseller/reseller-quota.service";
import type { ResellerShareService, ShareUsage } from "../reseller/reseller-share.service";
import type { WebhookEmitterService } from "../webhooks/webhook-emitter.service";
import type { WingsClientService } from "../wings/wings-client.service";
import { QuotaEnforcerService } from "./quota-enforcer.service";

const NODE = "11111111-1111-1111-1111-111111111111";
const RESELLER = "22222222-2222-2222-2222-222222222222";
const SERVER = "33333333-3333-3333-3333-333333333333";

/** Le plafond prêté aux deux sortes de périmètre, pour que 2048 déborde. */
const PLAFOND_MB = 1024;

/**
 * Lequel des deux plafonds existe dans ce banc.
 *
 * `les deux` n'est pas une commodité de test : c'est le cas qui met en jeu la
 * troisième règle du service — un seul serveur coupé par tour, quel que soit le
 * nombre de plafonds dépassés.
 */
type Decor = "part" | "enveloppe" | "les deux";

/** Une part et une enveloppe de 1024 Mo, et la consommation qu'on leur prête. */
function enforcer(usage: Partial<ShareUsage> & { memoryMb: number }, decor: Decor = "part") {
  const power = vi.fn(async () => {});
  const avecPart = decor === "part" || decor === "les deux";
  const avecEnveloppe = decor === "enveloppe" || decor === "les deux";

  /*
   * Base simulée, reconnue par les colonnes demandées et non par un compteur
   * d'appels : le service fait plusieurs tours, et un compteur global se
   * décalerait dès le second — ce qui ferait échouer le test pour une raison
   * qui n'a rien à voir avec ce qu'il vérifie.
   *
   * L'ordre des reconnaissances compte. La recherche du serveur le plus
   * gourmand demande elle aussi `nodeId` depuis qu'elle le rend dans le rappel,
   * et la tester après la liste des parts la ferait passer pour une part.
   */
  const db = {
    select: (fields: Record<string, unknown>) => ({
      from: () => {
        if ("memBytes" in fields) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: async () => [
                  { id: SERVER, name: "Banc", nodeId: NODE, memBytes: 900 * 1024 * 1024 },
                ],
              }),
            }),
          };
        }

        if ("nodeId" in fields) {
          // La liste des parts.
          return Promise.resolve(
            avecPart ? [{ nodeId: NODE, resellerId: RESELLER, memoryMb: PLAFOND_MB }] : [],
          );
        }

        if ("resellerId" in fields) {
          // La liste des enveloppes, filtrée sur celles qui posent un plafond.
          return {
            where: async () =>
              avecEnveloppe ? [{ resellerId: RESELLER, memoryMb: PLAFOND_MB }] : [],
          };
        }

        // La lecture du revendeur, pour sa notification.
        return { where: () => ({ limit: async () => [{ id: RESELLER }] }) };
      },
    }),
  } as unknown as Database;

  const mesure = {
    memoryMb: usage.memoryMb,
    diskMb: 0,
    servers: 1,
    basis: usage.basis ?? ("measured" as const),
    unmeasured: usage.unmeasured ?? 0,
  };

  const shares = {
    usageOnNode: async (): Promise<ShareUsage> => mesure,
  } as unknown as ResellerShareService;

  // L'enveloppe est mesurée par le service des quotas, celui-là même qui refuse
  // les créations : ce qu'on refuse et ce qu'on coupe doivent compter pareil.
  const quotas = {
    usageDetailedOf: async (): Promise<QuotaUsageDetailed> => mesure,
  } as unknown as ResellerQuotaService;

  const service = new QuotaEnforcerService(
    db,
    { power } as unknown as WingsClientService,
    shares,
    {
      notify: async () => {},
      notifyServerOwner: async () => {},
    } as unknown as NotificationsService,
    { emit: async () => {} } as unknown as WebhookEmitterService,
    quotas,
  );

  return { service, power };
}

describe("coupure sur dépassement de part", () => {
  it("ne coupe rien tant que la part n'est pas dépassée", async () => {
    const { service, power } = enforcer({ memoryMb: 512 });
    for (let i = 0; i < 5; i += 1) await service.tick();
    expect(power).not.toHaveBeenCalled();
  });

  it("laisse passer un pic avant d'agir", async () => {
    /*
     * Une génération de monde ou un chargement de plugins fait un pic d'une
     * minute. Couper à la première lecture arrêterait des serveurs qui étaient
     * simplement en train de démarrer.
     */
    const { service, power } = enforcer({ memoryMb: 2048 });

    await service.tick();
    expect(power).not.toHaveBeenCalled();
    await service.tick();
    expect(power).not.toHaveBeenCalled();

    await service.tick();
    expect(power).toHaveBeenCalledWith(SERVER, "stop");
  });

  it("ne coupe JAMAIS sur une consommation estimée", async () => {
    /*
     * La règle la plus importante du service. Faute de relevé, la consommation
     * est **majorée par les limites accordées** : le chiffre est au-dessus du
     * réel par construction. Agir dessus arrêterait des serveurs qui ne
     * consomment rien — et personne ne comprendrait pourquoi.
     */
    const estimee = enforcer({ memoryMb: 99_999, basis: "estimated", unmeasured: 3 });
    for (let i = 0; i < 10; i += 1) await estimee.service.tick();
    expect(estimee.power).not.toHaveBeenCalled();

    // Partiellement mesurée non plus : une partie majorée suffit à fausser la
    // somme, et on ne sait pas dire laquelle.
    const partielle = enforcer({ memoryMb: 99_999, basis: "partial", unmeasured: 1 });
    for (let i = 0; i < 10; i += 1) await partielle.service.tick();
    expect(partielle.power).not.toHaveBeenCalled();
  });

  it("remet le compteur à zéro quand la consommation redescend", async () => {
    // Deux dépassements suivis d'un retour sous le plafond ne doivent pas
    // s'additionner au prochain pic : ce ne serait plus un dépassement continu.
    const { service, power } = enforcer({ memoryMb: 2048 });
    await service.tick();
    await service.tick();

    const calme = enforcer({ memoryMb: 100 });
    await calme.service.tick();
    expect(calme.power).not.toHaveBeenCalled();

    // Le troisième tour du premier service agit : il a bien eu trois
    // dépassements consécutifs, lui.
    await service.tick();
    expect(power).toHaveBeenCalledTimes(1);
  });
});

describe("coupure sur dépassement d'enveloppe", () => {
  it("coupe un revendeur qui n'a aucune part", async () => {
    /*
     * Le cas qui n'était surveillé par personne : un revendeur sur son propre
     * matériel n'a pas de ligne dans les parts, donc le service ne le regardait
     * jamais. Son enveloppe ne lui était opposée qu'à la création — il pouvait
     * la dépasser indéfiniment tant qu'il ne commandait rien de nouveau.
     */
    const { service, power } = enforcer({ memoryMb: 2048 }, "enveloppe");

    await service.tick();
    await service.tick();
    expect(power).not.toHaveBeenCalled();

    await service.tick();
    expect(power).toHaveBeenCalledWith(SERVER, "stop");
  });

  it("respecte la même patience et la même exigence de mesure", async () => {
    // L'enveloppe n'est pas un plafond de seconde classe : elle obéit aux
    // mêmes règles, sans quoi on couperait plus vite là où l'urgence est
    // moindre — un dépassement d'enveloppe ne met en danger personne d'autre.
    const sousPlafond = enforcer({ memoryMb: 512 }, "enveloppe");
    for (let i = 0; i < 5; i += 1) await sousPlafond.service.tick();
    expect(sousPlafond.power).not.toHaveBeenCalled();

    const estimee = enforcer({ memoryMb: 99_999, basis: "estimated", unmeasured: 2 }, "enveloppe");
    for (let i = 0; i < 10; i += 1) await estimee.service.tick();
    expect(estimee.power).not.toHaveBeenCalled();
  });

  it("n'arrête qu'un seul serveur par tour, même en dépassant les deux", async () => {
    /*
     * La troisième règle du service, au moment précis où elle protège le plus.
     * Un revendeur qui déborde à la fois de sa part et de son enveloppe perdrait
     * deux serveurs dans la même minute si chaque plafond agissait pour son
     * compte — et « un serveur à la fois » cesserait d'être vrai.
     */
    const { service, power } = enforcer({ memoryMb: 2048 }, "les deux");

    for (let i = 0; i < 3; i += 1) await service.tick();
    expect(power).toHaveBeenCalledTimes(1);
  });
});
