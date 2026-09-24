import { describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller";

/**
 * « Mot de passe oublié » répond aussi vite pour une adresse connue que pour
 * une inconnue (audit ASVS, doute D-3).
 *
 * Le corps de la réponse ne distinguait déjà rien. Le temps, si : pour un
 * compte existant, la route attendait l'émission du jeton, le rendu du
 * courrier (marque, domaine) et l'écriture au journal avant de répondre —
 * quelques millisecondes sur une machine vide, bien davantage sous charge ou
 * avec une base lente. Assez pour trier une liste d'adresses.
 *
 * Le travail qui suit la lecture du compte part désormais en tâche détachée.
 * Le test le rend interminable : la route doit répondre quand même.
 */

const REQUEST = {
  ip: "203.0.113.7",
  headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0" },
  socket: { remoteAddress: "127.0.0.1" },
};

function controller(sendPasswordReset: () => Promise<unknown>) {
  const args: unknown[] = Array.from({ length: 19 }, () => ({}));
  args[0] = {
    findByEmail: async (email: string) =>
      email === "titulaire@gamedashboard.test"
        ? { id: "compte", email, passwordHash: "$argon2id$factice" }
        : null,
  };
  args[2] = { record: vi.fn(async () => undefined) };
  args[13] = { accepts: async () => true };
  args[15] = { sendPasswordReset: vi.fn(sendPasswordReset) };
  const auth = new (AuthController as unknown as new (...a: unknown[]) => AuthController)(...args);
  return { auth, mail: args[15] as { sendPasswordReset: ReturnType<typeof vi.fn> } };
}

/** Résout `promise`, ou rend `"en attente"` si elle ne s'est pas réglée d'elle-même. */
async function settled(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise.then(() => "répondu"),
    new Promise((resolve) => setTimeout(() => resolve("en attente"), 50)),
  ]);
}

describe("mot de passe oublié : pas d'énumération par le temps", () => {
  it("répond pour un compte existant sans attendre l'émission du lien", async () => {
    // Une émission qui ne finit jamais : base saturée, verrou tenu ailleurs.
    const { auth, mail } = controller(() => new Promise(() => undefined));

    const reponse = auth.forgotPassword(
      { email: "titulaire@gamedashboard.test" },
      REQUEST as never,
    );

    expect(await settled(reponse)).toBe("répondu");
    // Le lien part bien : il est seulement demandé sans être attendu.
    expect(mail.sendPasswordReset).toHaveBeenCalledOnce();
  });

  it("répond de la même façon pour une adresse inconnue, sans rien émettre", async () => {
    const { auth, mail } = controller(async () => "sent");

    expect(
      await settled(auth.forgotPassword({ email: "inconnu@gamedashboard.test" }, REQUEST as never)),
    ).toBe("répondu");
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("n'emporte pas le processus quand l'émission échoue", async () => {
    // Une tâche détachée dont le rejet n'est pas rattrapé tue le processus
    // sous Node 24 (voir `battre()`).
    const { auth } = controller(async () => {
      throw new Error("base injoignable");
    });
    const logger = (auth as unknown as { logger: { error: (...a: unknown[]) => void } }).logger;
    const trace = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await auth.forgotPassword({ email: "titulaire@gamedashboard.test" }, REQUEST as never);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(trace).toHaveBeenCalledOnce();
  });
});
