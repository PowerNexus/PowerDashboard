"use client";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_STRENGTH_LEVELS,
  type PasswordStrength,
  passwordStrength,
} from "@gamedashboard/contracts";
import { PasswordStrengthMeter } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";

/** Clé de traduction de chaque verdict : les identifiants d'une langue ne portent pas de tiret. */
const LABELS = {
  "too-short": "tooShort",
  "too-long": "tooLong",
  "contains-identity": "containsIdentity",
  acceptable: "acceptable",
  good: "good",
  strong: "strong",
} as const;

/** Refus en rouge, minimum atteint en orange, au-delà en vert. */
function toneOf(strength: PasswordStrength): "danger" | "warning" | "success" {
  if (strength.level <= 1) return "danger";
  return strength.level === 2 ? "warning" : "success";
}

/**
 * Jauge sous un champ de nouveau mot de passe (ASVS 2.1.8).
 *
 * La règle est celle de l'API — `passwordStrength` applique la même
 * politique, depuis les contrats partagés — et ce composant ne fait que la
 * traduire. L'API reste la règle : la présence dans les fuites connues ne se
 * juge que chez elle, et l'indication le rappelle.
 *
 * Rien tant que le champ est vide : la jauge répond à une saisie, elle ne
 * décore pas un formulaire.
 */
export function NewPasswordStrength({
  password,
  identity = [],
}: {
  password: string;
  /** Fragments de l'adresse et du nom, quand l'écran les connaît. */
  identity?: readonly string[];
}) {
  const t = useTranslations("passwordStrength");
  const strength = passwordStrength(password, identity);
  if (strength.verdict === "empty") return null;

  const hint =
    strength.verdict === "too-short"
      ? t("missing", { count: strength.minimum - strength.length })
      : strength.verdict === "too-long"
        ? t("tooLongHint", { maximum: PASSWORD_MAX_LENGTH })
        : strength.verdict === "contains-identity"
          ? t("identityHint")
          : strength.verdict === "acceptable"
            ? t("longerHint")
            : t("breachHint");

  return (
    <PasswordStrengthMeter
      level={strength.level}
      levels={PASSWORD_STRENGTH_LEVELS}
      tone={toneOf(strength)}
      label={t(LABELS[strength.verdict])}
      hint={hint}
    />
  );
}
