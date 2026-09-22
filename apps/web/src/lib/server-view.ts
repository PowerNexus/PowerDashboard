import type { ServerCardState } from "@gamedashboard/ui";
import type { ClientServer } from "@/server/api/client";

/** Forme attendue par `ServerGrid`, indépendante de la source des données. */
export interface ServerCardData {
  id: string;
  shortId: string;
  name: string;
  state: ServerCardState;
  address: string;
  nodeName: string;
  /** `null` tant que la mesure n'est pas parvenue : ce n'est pas zéro. */
  cpuPct: number | null;
  memoryMb: number | null;
  memoryMaxMb: number;
  diskMb: number | null;
  diskMaxMb: number;
  players: number | null;
  maxPlayers: number | null;
  isFavorite: boolean;
}

/**
 * Traduit un serveur de l'API en carte affichable.
 *
 * L'état affiché vient de deux sources, et l'ordre compte. L'état de gestion —
 * installation, suspension — prime, parce qu'il dit ce qui est en train d'être
 * fait au serveur. À défaut, on montre ce que le daemon a observé au dernier
 * relevé.
 *
 * C'est ce second terme qui manquait : la liste ne connaissait que l'état de
 * gestion, vide en temps normal, et présentait donc « hors ligne » tout serveur
 * qui tournait paisiblement — pendant que sa propre page, branchée sur le
 * websocket, le montrait en marche.
 */
export function toCardServer(server: ClientServer): ServerCardData {
  return {
    id: server.id,
    shortId: server.shortId,
    name: server.name,
    state: toCardState(server.state, server.runtimeState, server.nodeUnreachableSince),
    address: server.address,
    nodeName: server.nodeName,
    // Mesuré à la minute par le relevé de consommation. `null` reste « pas de
    // mesure récente », jamais zéro.
    cpuPct: server.cpuPct,
    memoryMb: server.memoryMb,
    memoryMaxMb: server.memoryMaxMb,
    diskMb: server.diskMb,
    diskMaxMb: server.diskMaxMb,
    // Ceux-là sont mesurés, eux : la sonde de jeu interroge le serveur comme
    // le ferait un joueur. `null` reste « pas de sonde récente », pas zéro.
    players: server.players,
    maxPlayers: server.maxPlayers,
    isFavorite: false,
  };
}

/**
 * Les états de gestion priment à l'affichage sur l'état du conteneur (§8.2).
 *
 * Un serveur suspendu dont le conteneur tourne encore doit se lire « suspendu »
 * : c'est la décision du panel qui compte, et elle sera appliquée. L'inverse
 * ferait cliquer sur « console » quelqu'un à qui tout sera refusé.
 *
 * `runtime` inconnu vaut « hors ligne », pas « inconnu » : un serveur dont on
 * n'a aucune nouvelle récente est, du point de vue d'un joueur, indisponible.
 */
export function toCardState(
  state: string | null,
  runtime?: string | null,
  /**
   * Depuis quand la machine se tait, ou `null`.
   *
   * Passé **après** l'état de gestion parce qu'il ne l'emporte pas : un
   * serveur suspendu reste suspendu même si sa machine tombe, et une
   * installation en cours reste une installation en cours — ce sont des
   * décisions du panel, que le silence d'un daemon ne remet pas en cause.
   * Ce qu'il remplace, c'est la **déduction** faite à partir du daemon : là
   * où l'on répondait « hors ligne » faute de nouvelles.
   */
  nodeUnreachableSince?: string | null,
): ServerCardState {
  switch (state) {
    case "installing":
      return "installing";
    case "suspended":
      return "suspended";
    case "restoring":
    case "transferring":
      return "starting";
    // Rendu tel quel : 00ab hors ligne 00bb 00e9tait exact et trompeur 2014 rien n'a jamais
    // 00e9t00e9 install00e9, et ce n'est pas un red00e9marrage qui y changera quelque chose.
    case "install_failed":
      return "install_failed";
    default:
      // La machine muette l'emporte sur ce que le dernier relevé disait : ce
      // relevé date d'avant la panne, et le resservir ferait passer une
      // information périmée pour l'état actuel.
      return nodeUnreachableSince ? "unknown" : toRuntimeState(runtime ?? null);
  }
}

/** Ce que le daemon a rapporté, ramené au vocabulaire des cartes. */
function toRuntimeState(runtime: string | null): ServerCardState {
  switch (runtime) {
    case "running":
      return "running";
    case "starting":
      return "starting";
    case "stopping":
      return "stopping";
    default:
      return "offline";
  }
}

/** Forme attendue par la coquille pour son sélecteur et sa palette. */
export function toShellServer(server: ClientServer) {
  return {
    id: server.id,
    name: server.name,
    shortId: server.shortId,
    address: server.address,
    game: server.game,
    nodeName: server.nodeName,
    // Même règle que les cartes : l'état de gestion d'abord, celui du conteneur
    // ensuite. Le sélecteur de la coquille affichait sinon toute la liste
    // éteinte pendant qu'on regardait une console bien vivante.
    state: toCardState(server.state, server.runtimeState, server.nodeUnreachableSince),
  };
}
