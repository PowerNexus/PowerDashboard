import { describeUserAgent } from "@gamedashboard/contracts";
import { DEFAULT_LOCALE, isLocale, type Locale, messagesFor } from "@gamedashboard/i18n";

/**
 * Textes des alertes de sécurité, dans la langue **du compte**.
 *
 * Ils viennent des catalogues de l'interface (`securityAlerts.*`) et non de
 * chaînes écrites ici : une alerte en français reçue par un anglophone serait
 * lue comme un hameçonnage, ce qui est exactement l'inverse de son but. La
 * langue est celle du compte et non celle de la requête : pour l'alerte
 * d'échecs, la requête est celle de l'attaquant.
 *
 * Courriels en texte brut, comme les autres du panel (voir `MailerService`) :
 * un message de sécurité qui ressemble à une page web ressemble surtout à
 * l'hameçonnage qu'il doit aider à reconnaître.
 */

type Texts = ReturnType<typeof messagesFor>["securityAlerts"];

function texts(locale: string): { locale: Locale; t: Texts } {
  const chosen = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { locale: chosen, t: messagesFor(chosen).securityAlerts };
}

/** Remplit les `{variables}` d'un message du catalogue. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * Date lisible, dans le fuseau du compte.
 *
 * Le fuseau est celui du titulaire : « 03:12 » à l'heure du serveur ne dit rien
 * à quelqu'un qui cherche s'il était devant son écran à ce moment-là. Le fuseau
 * est précisé dans le texte, pour qu'aucune lecture ne soit ambiguë.
 */
export function formatWhen(locale: string, timezone: string, at: Date): string {
  const { locale: chosen } = texts(locale);
  // Champs un à un : `dateStyle` refuse d'être combiné à `timeZoneName`.
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat(chosen, { ...options, timeZone: timezone }).format(at);
  } catch {
    // Fuseau illisible en base : UTC plutôt qu'une alerte perdue.
    return new Intl.DateTimeFormat(chosen, { ...options, timeZone: "UTC" }).format(at);
  }
}

/** « Firefox sur Windows », ou ce qu'on en sait. */
export function describeDevice(locale: string, userAgent: string | null): string {
  const { t } = texts(locale);
  const device = describeUserAgent(userAgent);
  if (device.browser && device.platform) {
    return fill(t.deviceOn, { browser: device.browser, platform: device.platform });
  }
  return device.browser ?? device.platform ?? device.raw ?? t.unknownDevice;
}

/** Nom d'un pays dans la langue du compte, à partir de son code ISO. */
export function countryName(locale: string, code: string): string {
  const { locale: chosen } = texts(locale);
  try {
    return new Intl.DisplayNames([chosen], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface AlertTexts {
  /** Titre de la cloche. */
  title: string;
  /** Corps de la cloche : une phrase, sans lien — la notification mène déjà à la page. */
  summary: string;
  subject: string;
  /** Corps du courriel. */
  text: string;
}

export function failureAlertTexts(input: {
  locale: string;
  brand: string;
  count: number;
  ip: string | null;
  when: string;
  link: string;
}): AlertTexts {
  const { t } = texts(input.locale);
  const body = fill(t.failureBody, {
    count: input.count,
    ip: input.ip ?? t.unknownIp,
    time: input.when,
  });

  return {
    title: t.failureTitle,
    summary: body,
    subject: fill(t.failureSubject, { brand: input.brand }),
    text: [body, "", t.failureAdvice, input.link, "", t.failureReassure, "", t.footer, ""].join(
      "\n",
    ),
  };
}

/**
 * Ce qui a changé dans les preuves d'identité d'un compte (ASVS 2.2.3, 2.5.5).
 *
 * Les clés du catalogue, telles quelles : un changement qui n'y figurerait pas
 * ne compilerait pas, plutôt que de partir sans titre.
 */
export type CredentialChange = keyof Texts["credentialChange"];

/**
 * Avis d'un changement d'authentifiant.
 *
 * Le changement d'adresse est à part : ce message part vers l'**ancienne**
 * boîte, et l'on se connecte désormais avec la nouvelle. Un lien vers la page
 * de sécurité n'y servirait qu'à celui qui a fait le changement ; c'est vers
 * le support qu'il faut renvoyer le titulaire.
 */
export function credentialChangeTexts(input: {
  locale: string;
  brand: string;
  kind: CredentialChange;
  /** Adresse d'où le geste a été fait ; nulle quand elle n'a pas à sortir. */
  ip: string | null;
  when: string;
  link: string;
}): AlertTexts {
  const { t } = texts(input.locale);
  const change = t.credentialChange[input.kind];
  const body = t.credentialBody[input.kind];

  const details = [
    // Sans adresse, la ligne disparaît : écrire « inconnue » laisserait croire
    // qu'on aurait pu la connaître.
    ...(input.ip ? [fill(t.detailIp, { ip: input.ip })] : []),
    fill(t.detailTime, { time: input.when }),
  ];
  const advice =
    input.kind === "emailChanged" ? [t.emailChangedAdvice] : [t.credentialAdvice, input.link];

  return {
    title: change,
    summary: body,
    subject: fill(t.credentialSubject, { change, brand: input.brand }),
    text: [body, "", ...details, "", ...advice, "", t.credentialReassure, "", t.footer, ""].join(
      "\n",
    ),
  };
}

export function newDeviceAlertTexts(input: {
  locale: string;
  brand: string;
  device: string;
  ip: string | null;
  /** Code ISO, seulement quand un intermédiaire de confiance l'a fourni. */
  country: string | null;
  when: string;
  link: string;
}): AlertTexts {
  const { t } = texts(input.locale);
  const ip = input.ip ?? t.unknownIp;

  const details = [
    fill(t.detailDevice, { device: input.device }),
    fill(t.detailIp, { ip }),
    // Sans en-tête de pays digne de foi, la ligne disparaît : écrire « Pays :
    // inconnu » inviterait à croire qu'on aurait pu le savoir.
    ...(input.country
      ? [fill(t.detailCountry, { country: countryName(input.locale, input.country) })]
      : []),
    fill(t.detailTime, { time: input.when }),
  ];

  return {
    title: t.newDeviceTitle,
    summary: fill(t.newDeviceSummary, { device: input.device, ip, time: input.when }),
    subject: fill(t.newDeviceSubject, { brand: input.brand }),
    text: [
      t.newDeviceBody,
      "",
      ...details,
      "",
      t.newDeviceAdvice,
      input.link,
      "",
      t.newDeviceReassure,
      "",
      t.footer,
      "",
    ].join("\n"),
  };
}
