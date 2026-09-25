import { describe, expect, it, vi } from "vitest";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import { MailerService } from "./mailer.service";

/**
 * L'expéditeur affiché suit la marque ; l'adresse d'envoi, jamais.
 *
 * Tous les courriels partaient sous l'adresse nue des réglages SMTP : le
 * client d'un revendeur recevait « no-reply@plateforme » sans nom, et ses
 * réponses repartaient vers la plateforme plutôt que vers son hébergeur.
 */
function monter() {
  const settings = {
    smtpConfiguration: async () => ({
      host: "smtp.test",
      port: 587,
      username: null,
      password: null,
      from: "no-reply@plateforme.fr",
    }),
  } as unknown as PlatformSettingsService;
  const service = new MailerService(settings);
  const sendMail = vi.fn(async (_message: Record<string, unknown>) => ({}));
  (service as unknown as { transportFor: () => unknown }).transportFor = () => ({ sendMail });
  return { service, sendMail };
}

describe("MailerService : expéditeur", () => {
  it("garde l'adresse SMTP et y met le nom de la marque, avec sa réponse", async () => {
    const { service, sendMail } = monter();

    await service.send({
      to: "client@exemple.fr",
      subject: "Sujet",
      text: "Corps",
      fromName: "Revendeur, « Hébergement »",
      replyTo: "support@revendeur.fr",
    });

    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: { name: "Revendeur, « Hébergement »", address: "no-reply@plateforme.fr" },
      replyTo: "support@revendeur.fr",
    });
  });

  it("n'ajoute ni nom ni réponse quand l'appelant n'en donne pas", async () => {
    const { service, sendMail } = monter();

    await service.send({ to: "client@exemple.fr", subject: "Sujet", text: "Corps" });

    const message = sendMail.mock.calls[0]?.[0] ?? {};
    expect(message.from).toBe("no-reply@plateforme.fr");
    expect(message).not.toHaveProperty("replyTo");
  });
});
