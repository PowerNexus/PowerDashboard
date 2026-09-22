"use client";

import type { ConsoleLine } from "@gamedashboard/ui";
import { stripAnsi } from "@gamedashboard/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { sendConsoleCommand, sendPowerSignal } from "@/server/api/console";

/**
 * Connexion au websocket de console de Wings.
 *
 * Le navigateur parle **directement** au daemon, avec un jeton court obtenu du
 * panel. Relayer ce flux par le panel en ferait un goulot d'étranglement : une
 * console active produit plusieurs lignes par seconde, pour chaque onglet
 * ouvert de chaque client.
 *
 * Le protocole est celui de Wings : on se connecte, on envoie `auth` avec le
 * jeton, puis on reçoit des événements `console output`, `stats`, `status`.
 */

export interface ServerStats {
  cpuPct: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
}

export type SocketPhase = "connecting" | "open" | "closed" | "error";

interface Grant {
  token: string;
  socket: string;
}

/** Nombre de lignes conservées. Au-delà, le navigateur commence à ramer. */
const MAX_LINES = 2000;

/**
 * Le préfixe que Wings colle à ses propres messages.
 *
 * Il est **renommé à l'affichage**, jamais dans le daemon : Wings reste
 * intact, c'est la règle du projet. La console est de toute façon le bon
 * endroit pour le faire — c'est là que le nom compte, et le remplacer à la
 * source obligerait à maintenir une version modifiée du daemon pour un
 * libellé.
 *
 * Le nom de la machine remplace « Pterodactyl » : sur un compte qui tient
 * plusieurs serveurs, savoir **quel node** parle vaut mieux que de lire le nom
 * d'un logiciel que le client n'a pas à connaître.
 */
const DAEMON_PREFIX = /^\[Pterodactyl Daemon\]:?\s*/;

/**
 * Ordre d'alimentation en attente de confirmation.
 *
 * Il existe parce que **l'ordre et son effet sont séparés par un long
 * silence**. Le panel envoie « start », l'API répond, et l'état affiché ne
 * bouge qu'au `status` que Wings renverra — après avoir vérifié le disque,
 * réécrit la configuration, ajusté les permissions et, la première fois, tiré
 * l'image Docker. Cela peut prendre plusieurs minutes.
 *
 * Pendant ce silence, l'ancien code laissait « Start » cliquable et le serveur
 * à « Hors ligne » : rien ne se passait, alors on recliquait. Trois clics,
 * trois ordres de démarrage pour le même conteneur.
 */
type PendingSignal = "start" | "stop" | "restart" | "kill";

/**
 * Ce que l'ordre en attente affiche, tant que le daemon n'a rien confirmé.
 *
 * Ce n'est **pas** un état inventé du daemon : c'est l'état de notre demande.
 * « Démarrage… » après avoir cliqué sur Start est exact — le serveur démarre,
 * puisqu'on vient de l'ordonner — là où « Hors ligne » était trompeur, et
 * c'est ce qui poussait à recliquer.
 */
const PENDING_STATE: Record<PendingSignal, "starting" | "stopping"> = {
  start: "starting",
  restart: "starting",
  stop: "stopping",
  kill: "stopping",
};

/** L'état que le daemon doit annoncer pour que l'ordre soit tenu pour accompli. */
const PENDING_GOAL: Record<PendingSignal, string> = {
  start: "running",
  restart: "running",
  stop: "offline",
  kill: "offline",
};

/**
 * Au-delà, on rend la main même sans confirmation.
 *
 * Cinq minutes, parce qu'un premier démarrage qui tire une image Docker les
 * prend parfois. Le verrou finit malgré tout par se lever : un garde-fou qui
 * ne se relâche jamais enferme le client dehors quand un ordre se perd, ce qui
 * est pire que le double-clic qu'il évitait.
 */
const PENDING_TIMEOUT_MS = 5 * 60_000;

export function useServerSocket(serverId: string, nodeName?: string) {
  const [phase, setPhase] = useState<SocketPhase>("connecting");
  const [state, setState] = useState<string | null>(null);
  const [stats, setStats] = useState<ServerStats | null>(null);

  /**
   * L'installation en cours, telle que le daemon la raconte.
   *
   * `null` tant qu'il n'a rien dit — ce qui n'est **pas** « pas
   * d'installation » : l'état de gestion du serveur, lui, vient de la base et
   * reste la source du blocage. Ceci ne sert qu'à suivre ce qui se passe.
   *
   * `lines` compte les lignes reçues : c'est la seule mesure d'avancement
   * honnête dont on dispose. Le daemon annonce le début et la fin, jamais un
   * pourcentage, et les scripts d'egg n'ont pas de longueur connue d'avance.
   */
  const [install, setInstall] = useState<{ running: boolean; lines: number } | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [pending, setPending] = useState<PendingSignal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  /*
   * Le même ordre, en référence.
   *
   * L'état React ne vaut qu'au rendu suivant ; deux clics dans la même image
   * liraient tous deux `pending === null` et enverraient deux ordres. La
   * référence, elle, est à jour dès la ligne suivante — c'est elle qui tient
   * le garde-fou, l'état ne fait que l'afficher.
   */
  const pendingRef = useRef<PendingSignal | null>(null);

  const label = nodeName ? `GameDashboard · ${nodeName}` : "GameDashboard";

  const append = useCallback(
    (text: string, source?: ConsoleLine["source"]) => {
      // Le flux du daemon est destiné à un terminal, pas à une page : sans ce
      // nettoyage, les séquences de contrôle s'affichent en clair au milieu des
      // lignes — c'est ainsi qu'un `ESC[6n` se lit « [6n » devant la commande.
      const clean = stripAnsi(text);

      /*
       * Une ligne du daemon devient une ligne du panel.
       *
       * Le préfixe quitte le texte pour devenir une étiquette : c'est ce qui
       * permet de la surligner d'un bloc, là où un préfixe collé au texte se
       * confondrait avec la sortie du jeu. Et comme ces messages sont ceux qui
       * disent pourquoi un serveur refuse de démarrer, ils doivent se voir.
       */
      const isDaemon = DAEMON_PREFIX.test(clean);

      setLines((current) => {
        const next = [
          ...current,
          {
            id: `${Date.now()}-${Math.random()}`,
            text: isDaemon ? clean.replace(DAEMON_PREFIX, "") : clean,
            source: isDaemon ? ("system" as const) : source,
            label: isDaemon || source === "system" ? label : undefined,
          },
        ];
        // Fenêtre glissante plutôt qu'accumulation : une console laissée
        // ouverte une nuit finirait par occuper toute la mémoire de l'onglet.
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    },
    [label],
  );

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;

    async function connect() {
      setPhase("connecting");

      const response = await fetch(`/api/servers/${serverId}/websocket`, { method: "POST" });
      if (!response.ok) {
        setPhase("error");
        append("Impossible d'obtenir une autorisation de connexion.", "system");
        return;
      }
      const { data } = (await response.json()) as { data: Grant };
      if (closed) return;

      socket = new WebSocket(data.socket);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        // Le jeton part dans un message, pas dans l'URL : une adresse se
        // retrouve dans l'historique du navigateur et les journaux du proxy.
        socket?.send(JSON.stringify({ event: "auth", args: [data.token] }));
      });

      socket.addEventListener("message", (message) => {
        const payload = parse(message.data);
        if (!payload) return;

        switch (payload.event) {
          case "auth success":
            setPhase("open");
            // L'historique n'arrive pas tout seul : il faut le demander.
            socket?.send(JSON.stringify({ event: "send logs", args: [null] }));
            break;
          case "console output":
            for (const line of payload.args ?? []) append(line);
            break;
          case "install output":
            /*
             * La sortie du script d'installation.
             *
             * Wings ne l'envoie qu'aux jetons portant `admin.websocket.install`
             * — son joker `*` exclut explicitement les permissions `admin.*`.
             * Elle n'arrivait donc jamais, et l'écran n'avait rien à montrer
             * pendant qu'un serveur s'installait.
             */
            for (const line of payload.args ?? []) append(line);
            setInstall((etat) => ({
              running: etat?.running ?? true,
              lines: (etat?.lines ?? 0) + (payload.args?.length ?? 0),
            }));
            break;
          case "install started":
            // Le compteur repart : une réinstallation n'est pas la suite de la
            // précédente.
            setInstall({ running: true, lines: 0 });
            break;
          case "install completed":
            setInstall((etat) => ({ running: false, lines: etat?.lines ?? 0 }));
            break;
          case "status":
            setState(payload.args?.[0] ?? null);
            break;
          case "stats":
            setStats(parseStats(payload.args?.[0]));
            break;
          case "token expiring":
          case "token expired":
            // Le jeton dure dix minutes ; on en redemande un avant l'échéance
            // plutôt que de laisser la console se couper en pleine lecture.
            void refresh(serverId, socket);
            break;
          case "jwt error":
            setPhase("error");
            append(`Connexion refusée : ${payload.args?.[0] ?? "jeton invalide"}`, "system");
            break;
          case "daemon error":
            append(payload.args?.[0] ?? "Erreur du daemon.", "system");
            break;
        }
      });

      socket.addEventListener("close", () => {
        if (!closed) setPhase("closed");
      });
      socket.addEventListener("error", () => {
        if (!closed) setPhase("error");
      });
    }

    void connect();

    return () => {
      closed = true;
      socket?.close();
      socketRef.current = null;
    };
  }, [serverId, append]);

  /*
   * Les ordres passent par le panel ; seule la sortie vient du websocket.
   *
   * Wings accepte `send command` et `set state` sur la socket, et c'est ce que
   * faisait cette console : un « ban » ou un « op » n'apparaissait alors nulle
   * part au journal d'activité, alors que le même geste fait par l'API y
   * figurait. Deux portes dont une seule surveillée ne surveille rien.
   *
   * L'API vérifie la permission, refuse pendant une installation, consigne, et
   * transmet. Un refus revient ici et s'affiche dans la console, à l'endroit
   * où l'on vient de taper — plutôt que de ne rien faire en silence.
   */
  const send = useCallback(
    (command: string) => {
      void sendConsoleCommand(serverId, command).then((result) => {
        if (result.error) append(result.error, "system");
      });
    },
    [serverId, append],
  );

  /** Pose l'ordre en attente, référence et état d'un seul geste. */
  const setPendingSignal = useCallback((signal: PendingSignal | null) => {
    pendingRef.current = signal;
    setPending(signal);
  }, []);

  const power = useCallback(
    (signal: string) => {
      // Un ordre déjà en vol suffit : le second ne ferait que doubler le
      // premier sur le même conteneur.
      if (pendingRef.current) return;
      setPendingSignal(signal as PendingSignal);

      void sendPowerSignal(serverId, signal).then((result) => {
        if (result.error) {
          // Refusé : on rend la main tout de suite. Garder le verrou après un
          // refus laisserait l'écran bloqué sur un ordre qui n'est jamais
          // parti.
          setPendingSignal(null);
          append(result.error, "system");
        }
      });
    },
    [serverId, append, setPendingSignal],
  );

  /*
   * L'ordre est tenu pour accompli quand le daemon annonce le but.
   *
   * Et seulement là : un `stopping` reçu pendant un redémarrage est une étape,
   * pas une arrivée. Lever le verrou dès le premier changement d'état ferait
   * réapparaître les boutons au milieu de la transition.
   */
  useEffect(() => {
    if (!pending || state === null) return;
    if (state === PENDING_GOAL[pending]) setPendingSignal(null);
  }, [state, pending, setPendingSignal]);

  /* Le verrou finit toujours par se lever, confirmation ou non. */
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setPendingSignal(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [pending, setPendingSignal]);

  /*
   * L'état rendu aux écrans : celui de la demande tant qu'elle est en vol.
   *
   * Replié ici plutôt que dans chaque page — et il en découle, gratuitement,
   * que `PowerControls` fait déjà ce qu'il faut : sur « starting » il grise
   * Start et Restart, et **laisse Stop et Kill actifs**. Un démarrage qui
   * s'éternise reste donc interruptible, là où un verrou posé sur les quatre
   * boutons aurait enfermé le client devant un écran qui ne répond plus.
   */
  const displayState = pending ? PENDING_STATE[pending] : state;

  return {
    phase,
    state: displayState,
    pending,
    stats,
    lines,
    install,
    send,
    power,
    append,
  };
}

async function refresh(serverId: string, socket: WebSocket | null): Promise<void> {
  const response = await fetch(`/api/servers/${serverId}/websocket`, { method: "POST" });
  if (!response.ok) return;
  const { data } = (await response.json()) as { data: Grant };
  socket?.send(JSON.stringify({ event: "auth", args: [data.token] }));
}

interface WingsEvent {
  event: string;
  args?: string[];
}

function parse(raw: unknown): WingsEvent | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as WingsEvent;
  } catch {
    // Un message illisible ne doit pas casser la console : on l'ignore.
    return null;
  }
}

/** Les statistiques arrivent en JSON encodé dans une chaîne. */
function parseStats(raw: string | undefined): ServerStats | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as {
      cpu_absolute: number;
      memory_bytes: number;
      memory_limit_bytes: number;
      disk_bytes: number;
      network: { rx_bytes: number; tx_bytes: number };
      uptime: number;
    };
    return {
      cpuPct: s.cpu_absolute,
      memoryBytes: s.memory_bytes,
      memoryLimitBytes: s.memory_limit_bytes,
      diskBytes: s.disk_bytes,
      networkRxBytes: s.network.rx_bytes,
      networkTxBytes: s.network.tx_bytes,
      uptimeMs: s.uptime,
    };
  } catch {
    return null;
  }
}
