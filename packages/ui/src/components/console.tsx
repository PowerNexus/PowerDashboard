"use client";

import { SendHorizontal, Upload } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";

export interface ConsoleLine {
  id: string | number;
  text: string;
  source?: "system" | "server";
  /**
   * Qui parle, pour les lignes qui ne viennent pas du jeu.
   *
   * Le daemon préfixe les siennes ; le panel remplace ce préfixe par un libellé
   * qui nomme la machine, et le passe ici plutôt que de le laisser dans le
   * texte : une étiquette séparée se met en valeur, un préfixe collé au texte
   * se confond avec la sortie du jeu.
   */
  label?: string;
}

export interface ConsoleViewProps {
  lines: ConsoleLine[];
  onSend?: (command: string) => void;
  onUpload?: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Libellés accessibles de la barre de saisie, pour les applications traduites. */
  commandLabel?: string;
  uploadLabel?: string;
  sendLabel?: string;
  className?: string;
  /** Hauteur de la zone de sortie. */
  height?: number | string;
}

/**
 * Console : zone de sortie sombre monospace avec autoscroll, champ de commande « $ »,
 * icônes upload et envoi. Sera remplacée par xterm.js en phase 2 en gardant les mêmes props.
 */
export function ConsoleView({
  lines,
  onSend,
  onUpload,
  disabled,
  placeholder = "Tapez une commande…",
  commandLabel = "Commande",
  uploadLabel = "Téléverser",
  sendLabel = "Envoyer",
  className,
  height = 480,
}: ConsoleViewProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const outRef = useRef<HTMLDivElement>(null);

  /*
   * La console est **accrochée au bas** tant qu'on ne l'a pas remontée.
   *
   * L'ancienne règle — « ne suivre que si l'on est déjà près du bas » — se
   * retournait contre elle-même à l'ouverture : l'historique arrive d'un coup,
   * la zone était en haut, donc loin du bas, donc on ne descendait pas. On
   * atterrissait sur les premières lignes du démarrage, et il fallait faire
   * défiler des centaines de lignes pour voir ce qui se passe maintenant.
   *
   * L'accroche ne se défait que par un geste : remonter le texte. Elle se
   * reprend dès qu'on redescend au bas — lire l'historique ne doit pas
   * condamner la console à ne plus jamais suivre.
   */
  const pinned = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll sur chaque nouvelle ligne
  useEffect(() => {
    const el = outRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cmd = value.trim();
    if (!cmd || disabled) return;
    onSend?.(cmd);
    setHistory((h) => [cmd, ...h].slice(0, 100));
    setCursor(-1);
    setValue("");
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-border bg-surface shadow-card",
        className,
      )}
    >
      <div
        ref={outRef}
        className="gd-mono overflow-y-auto bg-console-bg px-4 py-3 text-[13px] leading-6 text-console-fg"
        style={{ height }}
        aria-live="polite"
        onScroll={(e) => {
          // Une marge de quelques pixels : le défilement fluide et les
          // arrondis de hauteur font rarement tomber sur le bas exact, et sans
          // cette marge la console se décrocherait toute seule.
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {lines.length === 0 ? (
          <p className="text-faint">En attente de sortie…</p>
        ) : (
          /*
           * Les messages du panel et du daemon sont **surlignés**, pas
           * seulement colorés.
           *
           * Ils se perdaient au milieu de la sortie du jeu, qui défile vite et
           * porte déjà ses propres couleurs : « You need to agree to the EULA »
           * passait inaperçu entre deux lignes de chargement de chunks. Un fond
           * et un filet à gauche les détachent du flux, comme un trait de
           * surligneur sur une page imprimée.
           */
          lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                "whitespace-pre-wrap break-all",
                l.source === "system" &&
                  "-mx-2 my-0.5 rounded-field border-warning border-l-2 bg-warning/12 px-2 py-0.5 text-warning-ink",
              )}
            >
              {l.source === "system" ? (
                <span className="mr-2 font-semibold text-warning-ink/80">
                  [{l.label ?? "System"}]
                </span>
              ) : null}
              {l.text}
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={submit}
        className="flex items-center gap-3 border-t border-border bg-surface px-4 py-3"
      >
        <span className="gd-mono text-base font-bold text-accent">$</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              const next = Math.min(cursor + 1, history.length - 1);
              setCursor(next);
              setValue(history[next] ?? "");
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const next = Math.max(cursor - 1, -1);
              setCursor(next);
              setValue(next === -1 ? "" : (history[next] ?? ""));
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className="gd-mono min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint focus:shadow-none"
          aria-label={commandLabel}
        />
        {onUpload ? (
          <button
            type="button"
            onClick={onUpload}
            className="cursor-pointer text-muted hover:text-fg"
            aria-label={uploadLabel}
          >
            <Upload className="size-5" />
          </button>
        ) : null}
        <button
          type="submit"
          disabled={disabled}
          className="cursor-pointer text-muted hover:text-accent disabled:opacity-40"
          aria-label={sendLabel}
        >
          <SendHorizontal className="size-5" />
        </button>
      </form>
    </div>
  );
}
