import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface PasswordStrengthMeterProps {
  /** Crans remplis, de 0 à `levels`. */
  level: number;
  /** Nombre de crans de la jauge. */
  levels?: number;
  tone: "danger" | "warning" | "success";
  /** Le verdict, en toutes lettres : c'est ce que lit un lecteur d'écran. */
  label: string;
  /** Précision sous le verdict : caractères manquants, rappel des fuites. */
  hint?: ReactNode;
  className?: string;
}

const TONES = {
  danger: { bar: "bg-danger", text: "text-danger-ink" },
  warning: { bar: "bg-warning", text: "text-warning-ink" },
  success: { bar: "bg-success", text: "text-success-ink" },
};

/**
 * Jauge de force d'un mot de passe, sous le champ où on le choisit.
 *
 * **Elle ne juge rien.** Le niveau, le ton et le verdict viennent de
 * l'appelant, qui les tire de la politique partagée (`passwordStrength` dans
 * `@gamedashboard/contracts`) : une jauge qui calculerait de son côté finirait
 * par annoncer « bon » ce que l'API refuse.
 *
 * Le verdict est écrit, pas seulement coloré : une couleur seule ne dit rien à
 * qui ne la distingue pas. C'est lui que lit un lecteur d'écran, annoncé
 * poliment au fil de la frappe sans interrompre la saisie ; les crans, qui
 * redisent la même chose en image, lui sont cachés.
 */
export function PasswordStrengthMeter({
  level,
  levels = 4,
  tone,
  label,
  hint,
  className,
}: PasswordStrengthMeterProps) {
  const filled = Math.min(levels, Math.max(0, Math.round(level)));
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: levels }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: crans fixes, jamais réordonnés
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              index < filled ? TONES[tone].bar : "bg-surface-3",
            )}
          />
        ))}
      </div>
      <p className="text-xs" aria-live="polite">
        <span className={cn("font-semibold", TONES[tone].text)}>{label}</span>
        {hint ? <span className="text-muted"> — {hint}</span> : null}
      </p>
    </div>
  );
}
