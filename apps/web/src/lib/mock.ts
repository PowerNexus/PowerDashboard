import type { ServerRuntime } from "@gamedashboard/contracts";
import type { ConsoleLine, ServerCardState } from "@gamedashboard/ui";

/** Données de démonstration pour la phase 0. Remplacées par le SDK en phase 2. */
export interface MockServer {
  id: string;
  shortId: string;
  name: string;
  state: ServerCardState;
  address: string;
  nodeName: string;
  game: string;
  cpuPct: number;
  memoryMb: number;
  memoryMaxMb: number;
  diskMb: number;
  diskMaxMb: number;
  players: number;
  maxPlayers: number;
  isFavorite: boolean;
  /** Ce qui décide de la compatibilité des extensions du marketplace. */
  runtime: ServerRuntime;
}

export const MOCK_SERVERS: MockServer[] = [
  {
    id: "31201e0c",
    shortId: "31201e0c",
    name: "Merci GameDashboard.FR !",
    state: "running",
    address: "37.59.239.84:26002",
    nodeName: "RYZEN-GAME-09",
    game: "Minecraft",
    cpuPct: 42.18,
    memoryMb: 2148,
    memoryMaxMb: 3993,
    diskMb: 8420,
    diskMaxMb: 29900,
    players: 12,
    maxPlayers: 40,
    isFavorite: true,
    runtime: { game: "minecraft", loader: "paper", gameVersion: "1.21.4" },
  },
  {
    id: "a7f39b21",
    shortId: "a7f39b21",
    name: "Survie Moderne",
    state: "offline",
    address: "37.59.239.84:26014",
    nodeName: "RYZEN-GAME-09",
    game: "Minecraft",
    cpuPct: 0,
    memoryMb: 0,
    memoryMaxMb: 8192,
    diskMb: 14200,
    diskMaxMb: 40960,
    players: 0,
    maxPlayers: 60,
    isFavorite: false,
    runtime: { game: "minecraft", loader: "paper", gameVersion: "1.20.6" },
  },
  {
    id: "c0d5e881",
    shortId: "c0d5e881",
    name: "RolePlay FiveM",
    state: "starting",
    address: "51.210.44.12:30120",
    nodeName: "RYZEN-GAME-11",
    game: "FiveM",
    cpuPct: 88.4,
    memoryMb: 6100,
    memoryMaxMb: 16384,
    diskMb: 52300,
    diskMaxMb: 81920,
    players: 0,
    maxPlayers: 128,
    isFavorite: false,
    // FiveM ne dispose d'aucun catalogue public de ressources.
    runtime: { game: "fivem", loader: "any", gameVersion: "" },
  },
  {
    id: "5b1aa930",
    shortId: "5b1aa930",
    name: "Rust Vanilla FR",
    state: "installing",
    address: "51.210.44.12:28015",
    nodeName: "RYZEN-GAME-11",
    game: "Rust",
    cpuPct: 15.6,
    memoryMb: 1024,
    memoryMaxMb: 12288,
    diskMb: 3200,
    diskMaxMb: 61440,
    players: 0,
    maxPlayers: 200,
    isFavorite: false,
    // Rust n'épingle pas de version : les plugins Oxide suivent les forcées.
    runtime: { game: "rust", loader: "oxide", gameVersion: "" },
  },
];

export const MOCK_CONSOLE: ConsoleLine[] = [
  { id: 1, source: "system", text: "Démarrage du conteneur docker…" },
  { id: 2, source: "system", text: "Image ghcr.io/gamedashboard/java:21 déjà présente en cache." },
  { id: 3, text: "[12:04:01] [Server thread/INFO]: Starting minecraft server version 1.21.4" },
  { id: 4, text: "[12:04:01] [Server thread/INFO]: Loading properties" },
  { id: 5, text: "[12:04:02] [Server thread/INFO]: Default game type: SURVIVAL" },
  { id: 6, text: "[12:04:02] [Server thread/INFO]: Generating keypair" },
  { id: 7, text: "[12:04:03] [Server thread/INFO]: Starting Minecraft server on *:25565" },
  { id: 8, text: '[12:04:04] [Server thread/INFO]: Preparing level "world"' },
  { id: 9, text: "[12:04:07] [Server thread/INFO]: Preparing spawn area: 62%" },
  { id: 10, text: '[12:04:09] [Server thread/INFO]: Done (7.412s)! For help, type "help"' },
  { id: 11, text: "[12:05:33] [Server thread/INFO]: Matheo joined the game" },
  { id: 12, text: "[12:06:02] [Server thread/INFO]: <Matheo> salut tout le monde" },
];

/** Série pseudo-aléatoire déterministe, pour des graphes stables entre serveur et client. */
export function series(seed: number, n: number, base: number, amp: number) {
  let s = seed;
  return Array.from({ length: n }, (_, i) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    const noise = (s / 2147483648 - 0.5) * amp;
    return { t: i, v: Math.max(0, base + noise + Math.sin(i / 6) * amp * 0.5) };
  });
}
