"use client";

import { cn } from "../lib/cn";
import type { ServerCardState } from "./server-card";

export type PowerSignal = "start" | "stop" | "restart" | "kill";

export interface PowerControlsProps {
  state: ServerCardState;
  onSignal: (signal: PowerSignal) => void;
  disabled?: boolean;
  /**
   * Un état de gestion du panel ferme tout : installation, restauration,
   * transfert, suspension. Distinct de `disabled`, qui dit « pas maintenant »
   * (socket fermée, ordre en vol) ; celui-ci dit « pas dans cet état ».
   */
  blocked?: boolean;
  /** Libellé accessible du groupe, pour les applications traduites. */
  label?: string;
  className?: string;
}

/** Groupe Start / Restart / Stop / Kill, l'action pertinente est mise en avant selon l'état. */
/**
 * Quels ordres sont fermés, et pourquoi.
 *
 * Une fonction plutôt que quatre conditions dispersées dans le JSX : c'est
 * justement leur dispersion qui a laissé passer un défaut. En fermant les
 * boutons pendant un blocage, « Kill » — écrit `disabled || off` — s'est
 * retrouvé **ouvert**, parce que `off` valait alors faux. Une condition
 * exprimée par la négation d'une autre finit toujours par se retourner, et
 * quatre endroits font quatre occasions de l'oublier.
 *
 * Rend `true` pour « fermé ». Le nom des clés est celui des signaux, de sorte
 * qu'aucune traduction mentale ne s'intercale entre la règle et le bouton.
 */
export function closedSignals(
  state: string,
  options: { disabled?: boolean; blocked?: boolean } = {},
): { start: boolean; restart: boolean; stop: boolean; kill: boolean } {
  const { disabled = false, blocked = false } = options;

  // Un blocage ferme tout, sans exception à énumérer. L'écrire une fois ici
  // vaut mieux que quatre fois plus bas.
  if (disabled || blocked) return { start: true, restart: true, stop: true, kill: true };

  const running = state === "running";
  const transitioning = state === "starting" || state === "stopping";
  const off = state === "offline" || state === "crash_loop";

  return {
    start: !off,
    restart: !running,
    // Arrêter pendant un démarrage est légitime : c'est même le seul moyen
    // d'interrompre un démarrage qui s'éternise.
    stop: !running && !transitioning,
    // Tuer un serveur déjà à l'arrêt ne fait rien ; tout le reste l'autorise.
    kill: off,
  };
}

export function PowerControls({
  state,
  onSignal,
  disabled,
  blocked = false,
  label = "Alimentation",
  className,
}: PowerControlsProps) {
  const off = state === "offline" || state === "crash_loop";
  const closed = closedSignals(state, { disabled, blocked });
  const btn =
    "h-9 cursor-pointer px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-field border border-border bg-surface shadow-card",
        className,
      )}
      role="toolbar"
      aria-label={label}
    >
      <button
        type="button"
        disabled={closed.start}
        onClick={() => onSignal("start")}
        className={cn(
          btn,
          off ? "bg-accent text-accent-fg hover:bg-accent-600" : "text-muted hover:bg-surface-2",
        )}
      >
        Start
      </button>
      <button
        type="button"
        disabled={closed.restart}
        onClick={() => onSignal("restart")}
        className={cn(btn, "border-l border-border text-muted hover:bg-surface-2 hover:text-fg")}
      >
        Restart
      </button>
      <button
        type="button"
        disabled={closed.stop}
        onClick={() => onSignal("stop")}
        className={cn(btn, "border-l border-border text-muted hover:bg-surface-2 hover:text-fg")}
      >
        Stop
      </button>
      <button
        type="button"
        /*
         * `blocked` est écrit ici aussi, et pas déduit de `off`.
         *
         * Il l'était : `off` valait faux pendant un blocage, et « Kill » se
         * lisant `disabled || off` devenait donc **actif** — le seul des quatre
         * que le correctif avait ouvert au lieu de fermer. Une condition
         * exprimée par la négation d'une autre finit toujours par se retourner.
         */
        disabled={closed.kill}
        onClick={() => onSignal("kill")}
        className={cn(
          btn,
          "border-l border-border text-muted hover:bg-danger-soft hover:text-danger-ink",
        )}
      >
        Kill
      </button>
    </div>
  );
}
