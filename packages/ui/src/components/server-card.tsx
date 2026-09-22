"use client";

import { Cpu, ExternalLink, HardDrive, MemoryStick, Star, Users, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { StatusDot, type StatusTone } from "./status-dot";

export type ServerCardState =
  | "offline"
  | "starting"
  | "running"
  | "stopping"
  | "installing"
  /**
   * Installation interrompue.
   *
   * Manquait 00e0 cette union alors que le catalogue de libell00e9s la porte depuis
   * le d00e9but : un serveur dont l'installation a 00e9chou00e9 00e9tait ramen00e9 00e0 00ab hors
   * ligne 00bb, ce qui est exact et inutile 2014 on cherchait une panne de
   * d00e9marrage l00e0 o00f9 rien n'avait jamais 00e9t00e9 install00e9.
   */
  | "install_failed"
  | "suspended"
  | "crash_loop"
  | "restoring"
  | "transferring"
  /**
   * La machine ne répond plus : on ne sait pas ce que fait ce serveur.
   *
   * **Distinct de « hors ligne », qui est une affirmation.** Quand un node se
   * tait, le conteneur tourne peut-être encore ; nous ne le savons pas. Le
   * ramener à « hors ligne » revenait à annoncer une panne de serveur à qui
   * n'avait qu'une panne de machine — et à lui faire chercher du côté de son
   * jeu, là où il n'y avait rien à trouver.
   */
  | "unknown";

export const SERVER_STATE_META: Record<
  ServerCardState,
  { label: string; tone: StatusTone; pulse?: boolean }
> = {
  offline: { label: "Hors ligne", tone: "danger" },
  starting: { label: "Démarrage", tone: "warning", pulse: true },
  running: { label: "En ligne", tone: "success" },
  stopping: { label: "Arrêt", tone: "warning", pulse: true },
  installing: { label: "Installation", tone: "info", pulse: true },
  install_failed: { label: "Installation échouée", tone: "danger" },
  suspended: { label: "Suspendu", tone: "neutral" },
  crash_loop: { label: "Crash", tone: "danger", pulse: true },
  restoring: { label: "Restauration", tone: "info", pulse: true },
  transferring: { label: "Transfert", tone: "info", pulse: true },
  /*
   * `neutral` et sans battement : rien ne se passe, on ne sait simplement
   * pas. Un ton d'alerte accuserait le serveur d'une panne qu'il n'a
   * peut-être pas, et une pastille qui pulse ferait attendre un changement
   * qui ne viendra pas avant le retour de la machine.
   */
  unknown: { label: "Machine injoignable", tone: "neutral" },
};

export interface ServerCardProps {
  name: string;
  shortId: string;
  state: ServerCardState;
  address: string;
  nodeName: string;
  cpuPct: number;
  memoryLabel: string;
  diskLabel: string;
  playersLabel: string;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onOpen?: () => void;
  onManage?: () => void;
  /** Image de fond en filigrane (jeu). */
  backgroundUrl?: string;
  className?: string;
  /** Wrapper (ex. next/link) pour rendre toute la carte cliquable. */
  as?: (props: { className: string; children: ReactNode }) => ReactNode;
  /**
   * Libellés, pour les applications traduites.
   *
   * `stateLabel` remplace celui de SERVER_STATE_META : la carte affiche ce que
   * l'application lui donne plutôt que sa propre table, qui reste le repli.
   */
  stateLabel?: string;
  onLabel?: string;
  addFavoriteLabel?: string;
  removeFavoriteLabel?: string;
  openLabel?: string;
  manageLabel?: string;
}

/** Carte serveur (liste « My Servers ») : état, favori, nom, id court, IP, node, 4 métriques, 2 actions. */
export function ServerCard(props: ServerCardProps) {
  const {
    name,
    shortId,
    state,
    address,
    nodeName,
    cpuPct,
    memoryLabel,
    diskLabel,
    playersLabel,
    isFavorite,
    onToggleFavorite,
    onOpen,
    onManage,
    backgroundUrl,
    className,
    as: As,
    stateLabel,
    onLabel = "sur",
    addFavoriteLabel = "Ajouter aux favoris",
    removeFavoriteLabel = "Retirer des favoris",
    openLabel = "Ouvrir la console",
    manageLabel = "Gérer",
  } = props;
  const meta = SERVER_STATE_META[state];
  const label = stateLabel ?? meta.label;

  const content = (
    <>
      {backgroundUrl ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08] [background-size:cover] [background-position:center]"
          style={{ backgroundImage: `url(${backgroundUrl})` }}
        />
      ) : null}
      <div className="relative flex items-start gap-3 p-4">
        <StatusDot tone={meta.tone} pulse={meta.pulse} label={label} className="mt-2" />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite?.();
          }}
          className={cn(
            "mt-1 cursor-pointer text-faint transition-colors hover:text-warning-ink",
            isFavorite && "text-warning-ink",
          )}
          aria-label={isFavorite ? removeFavoriteLabel : addFavoriteLabel}
        >
          <Star className={cn("size-4", isFavorite && "fill-current")} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-base font-semibold text-fg">{name}</h3>
            <span className="gd-mono text-xs text-faint">{shortId}</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            <span className="gd-mono">{address}</span> <span className="text-faint">{onLabel}</span>{" "}
            {nodeName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <CardAction icon={<ExternalLink />} label={openLabel} onClick={onOpen} />
          <CardAction icon={<Wrench />} label={manageLabel} onClick={onManage} />
        </div>
      </div>
      <div className="relative grid grid-cols-4 gap-2 border-t border-border bg-surface-2/50 px-4 py-2.5 text-xs">
        <Metric icon={<Cpu />} value={`${cpuPct.toFixed(2)} %`} />
        <Metric icon={<MemoryStick />} value={memoryLabel} />
        <Metric icon={<HardDrive />} value={diskLabel} />
        <Metric icon={<Users />} value={playersLabel} />
      </div>
    </>
  );

  const cls = cn(
    "relative block overflow-hidden rounded-card border border-border bg-surface shadow-card transition-colors hover:border-border-strong",
    className,
  );
  return As ? As({ className: cls, children: content }) : <div className={cls}>{content}</div>;
}

function Metric({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}
      <span className="gd-mono truncate text-fg">{value}</span>
    </span>
  );
}

function CardAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
      className="inline-flex size-8 cursor-pointer items-center justify-center rounded-xs bg-surface-2 text-muted transition-colors hover:bg-accent-soft hover:text-accent [&_svg]:size-4"
    >
      {icon}
    </button>
  );
}
