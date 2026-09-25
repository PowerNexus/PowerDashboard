import type {
  WingsInstallationScript,
  WingsInstallStatus,
  WingsServerListResponse,
} from "@gamedashboard/contracts";
import {
  allocations,
  type Database,
  eggs,
  eggVariables,
  mounts,
  serverEngines,
  serverMounts,
  servers,
  serverVariables,
} from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { NotificationsService } from "../notifications/notifications.service";
import { WebhookEmitterService } from "../webhooks/webhook-emitter.service";

/**
 * Traduction entre notre modèle et celui qu'attend Wings.
 *
 * C'est le seul endroit où cette traduction a lieu (§7.5). La tentation serait
 * d'aligner le modèle interne sur le format du daemon pour éviter la
 * conversion : ce serait laisser un composant que nous ne contrôlons pas
 * dicter notre schéma, et hériter de ses contraintes à chacune de ses
 * versions.
 */
@Injectable()
export class RemoteServerService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(WebhookEmitterService) private readonly webhooks: WebhookEmitterService,
  ) {}

  async list(
    nodeId: string,
    { page, perPage }: { page: number; perPage: number },
  ): Promise<WingsServerListResponse> {
    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(servers)
      .where(eq(servers.nodeId, nodeId));
    const total = counted?.total ?? 0;

    const rows = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.nodeId, nodeId))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const configurations = await Promise.all(rows.map((row) => this.buildConfiguration(row.id)));

    const count = total;
    const lastPage = Math.max(1, Math.ceil(count / perPage));
    const from = count === 0 ? 0 : (page - 1) * perPage + 1;

    return {
      data: configurations.filter((c): c is NonNullable<typeof c> => c !== null),
      // Wings lit ces six champs sans tolérance : un champ manquant devient un
      // zéro silencieux, et sa pagination s'arrête à la première page — donc
      // seuls les cinquante premiers serveurs du node seraient supervisés.
      meta: {
        current_page: page,
        from,
        last_page: lastPage,
        per_page: perPage,
        to: Math.min(count, page * perPage),
        total: count,
      },
    };
  }

  async configuration(nodeId: string, uuid: string) {
    const [row] = await this.db
      .select({ id: servers.id })
      .from(servers)
      // Le node est contraint en plus de l'uuid : un node compromis ne doit pas
      // pouvoir lire la configuration d'un serveur qui ne lui appartient pas.
      .where(and(eq(servers.id, uuid), eq(servers.nodeId, nodeId)))
      .limit(1);

    return row ? this.buildConfiguration(row.id) : null;
  }

  /**
   * Montages d'un serveur, au format du daemon.
   *
   * `read_only` en serpent et non en camel : c'est le nom que Wings attend, et
   * une clé qu'il ne reconnaît pas vaut `false` — donc un montage annoncé en
   * lecture seule serait monté en écriture. Le genre d'écart silencieux qui ne
   * se voit qu'au moment où un serveur écrit dans les cartes de ses voisins.
   */
  private async mountsFor(serverId: string) {
    const rows = await this.db
      .select({ source: mounts.source, target: mounts.target, readOnly: mounts.readOnly })
      .from(serverMounts)
      .innerJoin(mounts, eq(serverMounts.mountId, mounts.id))
      .where(eq(serverMounts.serverId, serverId));

    return rows.map((row) => ({ source: row.source, target: row.target, read_only: row.readOnly }));
  }

  /**
   * Configuration servie au node **d'arrivée** d'un transfert.
   *
   * Sans contrainte de node, contrairement à `configuration()` — et c'est
   * précisément pourquoi elle porte un autre nom. Le droit de lire a déjà été
   * établi par le contrôleur, qui a vérifié qu'un transfert vers ce node est en
   * cours pour ce serveur. Réutiliser la méthode ordinaire en lui passant un
   * node « quelconque » aurait dissous ce contrôle dans une route qui ne s'en
   * serait pas aperçue.
   */
  async configurationForTransfer(uuid: string) {
    const [row] = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, uuid))
      .limit(1);

    return row ? this.buildConfiguration(row.id) : null;
  }

  async installationScript(nodeId: string, uuid: string): Promise<WingsInstallationScript | null> {
    const [row] = await this.db
      .select({
        script: eggs.installScript,
        container: eggs.installContainer,
        entrypoint: eggs.installEntrypoint,
      })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .where(and(eq(servers.id, uuid), eq(servers.nodeId, nodeId)))
      .limit(1);

    if (!row) return null;
    return {
      container_image: row.container,
      entrypoint: row.entrypoint,
      script: row.script,
    };
  }

  async markInstalled(nodeId: string, uuid: string, status: WingsInstallStatus): Promise<void> {
    const touched = await this.db
      .update(servers)
      .set({
        state: status.successful ? null : "install_failed",
        // La date d'installation ne se réécrit qu'en cas de succès : un échec
        // de réinstallation ne doit pas effacer la trace de la première.
        ...(status.successful ? { installedAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(servers.id, uuid), eq(servers.nodeId, nodeId)))
      .returning({ id: servers.id });

    // Un serveur qui n'est pas sur ce node : rien n'a changé, et rien ne part.
    // Sans cette garde, un node pouvait faire sonner « installation échouée »
    // chez n'importe quel client et prévenir la facturation pour lui.
    if (touched.length === 0) return;

    /*
     * Le moteur retenu par le panel n'est plus vrai.
     *
     * Le script de l'egg vient de reposer le serveur : ce qu'il exécute est ce
     * que ce script a installé, que le panel ne connaît pas. Garder la ligne
     * ferait afficher « Paper 1.21.1 » sur un serveur revenu à l'egg, et
     * proposer la mise à jour d'un pack que le script vient peut-être
     * d'écraser. Seulement sur une réussite : un échec n'a rien remplacé.
     */
    if (status.successful) {
      await this.db.delete(serverEngines).where(eq(serverEngines.serverId, uuid));
    }

    /**
     * Le propriétaire est prévenu.
     *
     * C'est l'un des rares moments qui méritent une cloche : l'installation
     * prend plusieurs minutes, personne ne reste devant l'écran à attendre, et
     * son issue décide si le serveur est utilisable ou non.
     */
    await this.notifications.notifyServerOwner(uuid, {
      type: "server.installed",
      level: status.successful ? "success" : "danger",
      title: status.successful ? "Installation terminée" : "Installation échouée",
      body: status.successful
        ? "Votre serveur est prêt à démarrer."
        : "Le script d'installation s'est arrêté sur une erreur. Une réinstallation depuis les paramètres peut suffire.",
    });

    /**
     * Et le système tiers aussi.
     *
     * C'est **le** rappel qui compte pour une boutique : c'est ici, et pas à la
     * création, que le serveur devient utilisable. Écrire au client « votre
     * serveur est prêt » au moment de la commande serait faux de plusieurs
     * minutes, et faux tout court si l'installation échoue.
     *
     * Deux événements distincts plutôt qu'un seul portant un booléen : un
     * abonné qui ne veut être prévenu que des échecs ne doit pas avoir à
     * recevoir tous les succès pour les filtrer lui-même.
     */
    await this.webhooks.emit(status.successful ? "server.installed" : "server.install_failed", {
      serverId: uuid,
      reinstall: status.reinstall,
    });
  }

  /**
   * Remise à zéro des états transitoires au démarrage du daemon.
   *
   * Seuls les états que le daemon portait sont effacés. `suspended` est une
   * décision administrative, qu'un redémarrage de Wings n'a aucune raison de
   * lever — ce serait rendre l'accès à un client suspendu pour impayé.
   */
  async resetTransientStates(nodeId: string): Promise<void> {
    await this.db
      .update(servers)
      .set({ state: null, updatedAt: new Date().toISOString() })
      .where(and(eq(servers.nodeId, nodeId), inArray(servers.state, ["installing", "restoring"])));
  }

  /**
   * L'environnement remis au daemon, construit depuis les variables du serveur.
   *
   * **Relevé sur un vrai daemon, et c'était le défaut le plus coûteux.** La
   * colonne `servers.environment` est écrite vide au provisionnement — les
   * valeurs, elles, vivent dans `server_variables`. L'envoyer telle quelle
   * donnait `environment: {}`, et trois conséquences en cascade :
   *
   * - le script d'installation de l'egg n'avait aucune version à télécharger et
   *   se terminait en une seconde, en **annonçant un succès** ;
   * - la commande de démarrage gardait ses gabarits : Wings lançait
   *   littéralement `java -jar {{SERVER_JARFILE}}` ;
   * - le conteneur sortait aussitôt en code 1, et le panel n'affichait qu'un
   *   serveur « hors ligne » sans rien qui explique pourquoi.
   *
   * Les variables sont donc relues ici, à chaque configuration demandée. Pas de
   * cache dans `servers.environment` : deux copies d'une même vérité finissent
   * par diverger, et c'est exactement ce qui vient d'arriver.
   *
   * Les variables calculées s'ajoutent par-dessus, sans jamais être écrasées
   * par celles de l'egg : `SERVER_PORT` doit être le port réellement alloué,
   * quoi qu'un egg importé en dise.
   */
  private async environmentFor(
    serverId: string,
    context: {
      memoryMb: number;
      ip: string;
      port: number;
      startup: string;
      stored: unknown;
    },
  ): Promise<Record<string, string>> {
    const declared = await this.db
      .select({ name: eggVariables.envVariable, value: serverVariables.value })
      .from(serverVariables)
      .innerJoin(eggVariables, eq(serverVariables.eggVariableId, eggVariables.id))
      .where(eq(serverVariables.serverId, serverId));

    const environment: Record<string, string> = {};

    // Ce que la colonne portait éventuellement : conservé, pour ne rien perdre
    // d'une valeur posée à la main.
    for (const [name, value] of Object.entries((context.stored ?? {}) as Record<string, unknown>)) {
      if (typeof value === "string") environment[name] = value;
    }

    for (const variable of declared) environment[variable.name] = variable.value;

    /*
     * Les variables que le panel connaît seul.
     *
     * Les eggs publics s'en servent abondamment — `-Xmx{{SERVER_MEMORY}}M`,
     * `--port {{SERVER_PORT}}` — et aucune ne peut venir de l'egg : elles
     * dépendent du plan et de l'allocation réservée à ce serveur précis.
     */
    environment.STARTUP = context.startup;
    environment.SERVER_MEMORY = String(context.memoryMb);
    environment.SERVER_IP = context.ip;
    environment.SERVER_PORT = String(context.port);
    environment.P_SERVER_UUID = serverId;
    environment.P_SERVER_ALLOCATION_LIMIT = "0";

    return environment;
  }

  /**
   * Construit la charge utile attendue par Wings pour un serveur.
   *
   * `settings` et `process_configuration` sont opaques pour le daemon, qui les
   * transmet à ses sous-systèmes. Leur contenu détaillé arrivera avec le
   * module des eggs ; la forme extérieure, elle, est déjà celle qu'il attend.
   */
  private async buildConfiguration(serverId: string) {
    const [row] = await this.db
      .select({
        uuid: servers.id,
        name: servers.name,
        description: servers.description,
        memoryMb: servers.memoryMb,
        swapMb: servers.swapMb,
        diskMb: servers.diskMb,
        ioWeight: servers.ioWeight,
        cpuPct: servers.cpuPct,
        threads: servers.threads,
        oomKiller: servers.oomKiller,
        dockerImage: servers.dockerImage,
        startup: servers.startup,
        environment: servers.environment,
        state: servers.state,
        eggId: eggs.id,
        fileDenylist: eggs.fileDenylist,
        configFiles: eggs.configFiles,
        configStartup: eggs.configStartup,
        configStop: eggs.configStop,
        defaultIp: allocations.ip,
        defaultPort: allocations.port,
      })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .innerJoin(allocations, eq(servers.allocationId, allocations.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) return null;

    // Toutes les allocations du serveur, pas seulement celle par défaut : un
    // serveur peut en porter plusieurs (§6.2), et Wings les publie toutes.
    const ports = await this.db
      .select({ ip: allocations.ip, port: allocations.port })
      .from(allocations)
      .where(eq(allocations.serverId, serverId));

    const mappings: Record<string, number[]> = {};
    for (const { ip, port } of [{ ip: row.defaultIp, port: row.defaultPort }, ...ports]) {
      mappings[ip] ??= [];
      const list = mappings[ip];
      if (!list.includes(port)) list.push(port);
    }

    const environment = await this.environmentFor(serverId, {
      memoryMb: row.memoryMb,
      ip: row.defaultIp,
      port: row.defaultPort,
      startup: row.startup,
      stored: row.environment,
    });

    return {
      uuid: row.uuid,
      settings: {
        uuid: row.uuid,
        meta: { name: row.name, description: row.description ?? "" },
        suspended: row.state === "suspended",
        invocation: row.startup,
        environment,
        skip_egg_scripts: false,
        /**
         * Sans ce bloc, `{SERVER_IP}` et `{SERVER_PORT}` restent introuvables :
         * le serveur démarre sur une adresse vide et les fichiers de
         * configuration réécrits par l'egg pointent dans le vide.
         */
        allocations: {
          force_outgoing_ip: false,
          default: { ip: row.defaultIp, port: row.defaultPort },
          mappings,
        },
        build: {
          memory_limit: row.memoryMb,
          swap: row.swapMb,
          io_weight: row.ioWeight,
          cpu_limit: row.cpuPct,
          threads: row.threads,
          disk_space: row.diskMb,
          // Le champ dit « désactivé » : cocher « tueur OOM actif » côté panel
          // revient donc à transmettre `false`. L'inverser rendrait un serveur
          // à court de mémoire indéfiniment bloqué au lieu d'être arrêté.
          oom_disabled: !row.oomKiller,
        },
        crash_detection_enabled: true,
        labels: {},
        /*
         * Les montages attachés à ce serveur.
         *
         * Le champ était une liste vide en dur, ce qui rendait les tables
         * `mounts` et `server_mounts` inertes : on pouvait déclarer un dossier
         * partagé, l'attacher, et le daemon n'en entendait jamais parler.
         *
         * Le daemon refusera de lui-même ceux dont la source n'est pas dans son
         * `allowed_mounts` : le panel propose, la machine dispose.
         */
        mounts: await this.mountsFor(serverId),
        egg: { id: row.eggId, file_denylist: row.fileDenylist },
        container: { image: row.dockerImage },
      },
      process_configuration: {
        startup: parseStartupConfiguration(row.configStartup),
        // `stop` est un objet `{type, value}` et non une chaîne : le type dit
        // s'il faut envoyer une commande à la console ou un signal au conteneur.
        stop: parseStopConfiguration(row.configStop),
        configs: parseConfigFiles(row.configFiles, {
          uuid: row.uuid,
          name: row.name,
          build: {
            default: { ip: row.defaultIp, port: row.defaultPort },
            env: environment,
            memory: row.memoryMb,
            swap: row.swapMb,
            io: row.ioWeight,
            cpu: row.cpuPct,
            disk: row.diskMb,
            threads: row.threads,
          },
        }),
      },
    };
  }
}

/**
 * Traduit la commande d'arrêt d'un egg au format attendu par Wings.
 *
 * Le format Pterodactyl accepte soit une commande console (`stop`, `end`),
 * soit un signal préfixé par `^` (`^C`, `^SIGTERM`). Une valeur absente vaut
 * `SIGTERM` : sans cela, Wings ne saurait pas comment arrêter proprement le
 * serveur et le tuerait, ce qui, sur un serveur de jeu, revient à perdre la
 * dernière sauvegarde du monde.
 */
/** Ce que Wings attend sous `process_configuration.configs`. */
export interface WingsConfigurationFile {
  file: string;
  parser: string;
  replace: { match: string; if_value?: string; replace_with: string }[];
}

/**
 * Traduit les fichiers de configuration d'un egg au format attendu par Wings.
 *
 * **C'est la traduction qui empêchait de jouer.** Les eggs de Pterodactyl
 * rangent ces règles en objet, indexé par nom de fichier :
 *
 *     {"server.properties": {"parser": "properties",
 *                            "find": {"server-port": "{{server.build.default.port}}"}}}
 *
 * Wings, lui, attend un **tableau** de `{file, parser, replace}`. Le panel
 * passait la valeur telle quelle, et comme ce n'était pas un tableau, il
 * envoyait une liste vide : Wings ne réécrivait donc jamais `server.properties`.
 * Le serveur gardait `server-port=25565` pendant que le conteneur publiait le
 * port de l'allocation — 25566 — et personne ne pouvait se connecter. Rien
 * n'était en panne, aucun journal ne disait rien : le port écouté et le port
 * publié n'étaient simplement pas le même.
 *
 * Une valeur de remplacement peut être une chaîne — « remplace toujours » — ou
 * un objet qui conditionne le remplacement à la valeur trouvée :
 * `{"127.0.0.1": "0.0.0.0"}` se lit « si c'est 127.0.0.1, mets 0.0.0.0 ».
 * Wings exprime le second par `if_value`.
 *
 * Ce qui n'est pas reconnu est **écarté**, pas deviné : une règle mal formée
 * envoyée au daemon ferait échouer la désérialisation de toute la
 * configuration, et le serveur ne démarrerait plus du tout.
 */
export function parseConfigFiles(
  value: unknown,
  context: Record<string, unknown> = {},
): WingsConfigurationFile[] {
  // Déjà au format de Wings : un egg importé depuis un panel qui a fait la
  // traduction avant nous. On le laisse passer.
  if (Array.isArray(value)) return value as WingsConfigurationFile[];
  if (value === null || typeof value !== "object") return [];

  const files: WingsConfigurationFile[] = [];

  for (const [file, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object") continue;
    const entry = raw as { parser?: unknown; find?: unknown };
    if (entry.find === null || typeof entry.find !== "object") continue;

    const replace: WingsConfigurationFile["replace"] = [];
    for (const [match, target] of Object.entries(entry.find as Record<string, unknown>)) {
      if (typeof target === "string") {
        replace.push({ match, replace_with: resolveServerTokens(target, context) });
        continue;
      }
      if (target !== null && typeof target === "object") {
        for (const [ifValue, replaceWith] of Object.entries(target as Record<string, unknown>)) {
          if (typeof replaceWith === "string") {
            replace.push({
              match,
              if_value: ifValue,
              replace_with: resolveServerTokens(replaceWith, context),
            });
          }
        }
      }
    }

    if (replace.length > 0) {
      // `properties` par défaut : c'est le format le plus répandu, mais surtout
      // un analyseur absent ferait rejeter le fichier entier par Wings.
      files.push({
        file,
        parser: typeof entry.parser === "string" ? entry.parser : "properties",
        replace,
      });
    }
  }

  return files;
}

/**
 * Remplit les gabarits `{{server.…}}` avant l'envoi au daemon.
 *
 * **Relevé sur un vrai Wings, et c'est la moitié du même défaut.** Le daemon ne
 * résout qu'une famille de gabarits, `{{config.…}}`, qui désigne sa **propre**
 * configuration — l'interface Docker, son adresse interne. Tout ce qui commence
 * par `server.` est au panel de le remplir : Wings le recopie tel quel. Une
 * fois la traduction en tableau faite, `server.properties` recevait donc
 * littéralement `server-port={{server.build.default.port}}`, ce qui ne vaut pas
 * mieux qu'un port resté à 25565.
 *
 * Un gabarit introuvable devient une chaîne vide, et non le gabarit lui-même :
 * une valeur vide dans un fichier de configuration se voit et se corrige, là où
 * `{{server.build.env.TRUC}}` recopié dans `server.properties` s'y installe
 * durablement et déroute qui le lit en SFTP.
 */
export function resolveServerTokens(text: string, context: Record<string, unknown>): string {
  return text.replace(/\{\{\s*server\.([\w.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = path
      .split(".")
      .reduce<unknown>(
        (current, key) =>
          current !== null && typeof current === "object"
            ? (current as Record<string, unknown>)[key]
            : undefined,
        context,
      );

    return value === null || value === undefined || typeof value === "object" ? "" : String(value);
  });
}

/** Ce que Wings attend sous `process_configuration.startup`. */
export interface WingsStartupConfiguration {
  done: string[];
  user_interaction: string[];
  strip_ansi: boolean;
}

/**
 * Traduit la détection de démarrage d'un egg au format attendu par Wings.
 *
 * **Relevé sur un vrai daemon**, et c'est le genre d'écart qu'aucun test du
 * panel ne voit : les eggs Pterodactyl écrivent `done` tantôt en chaîne —
 * `{"done": ")! For help, type "}` — tantôt en tableau, et le passer tel quel
 * fait échouer Wings à la désérialisation :
 *
 *     cannot unmarshal string into Go struct field
 *     .process_configuration.startup.done of type []*remote.OutputLineMatcher
 *
 * La création du serveur s'arrête alors sur un 500 dont rien, côté panel, ne
 * dit la cause. Wings attend un **tableau**, toujours, et accepte chaque
 * entrée comme une chaîne à comparer — éventuellement préfixée par `regex:`.
 *
 * Une détection absente rend un tableau vide plutôt qu'une valeur inventée :
 * le daemon considère alors le serveur démarré dès que le processus tourne,
 * ce qui est le comportement d'origine de Wings. Inventer un marqueur ferait
 * attendre indéfiniment un message qui ne viendra jamais.
 */
export function parseStartupConfiguration(value: unknown): WingsStartupConfiguration {
  const raw = (value ?? {}) as {
    done?: unknown;
    userInteraction?: unknown;
    user_interaction?: unknown;
    stripAnsi?: unknown;
    strip_ansi?: unknown;
  };

  return {
    done: toLines(raw.done),
    // Les deux graphies coexistent dans les eggs publiés : celle de
    // Pterodactyl et celle que produisent certains exportateurs.
    user_interaction: toLines(raw.userInteraction ?? raw.user_interaction),
    strip_ansi: raw.stripAnsi === true || raw.strip_ansi === true,
  };
}

/** Une chaîne, un tableau de chaînes, ou rien : toujours un tableau en sortie. */
function toLines(value: unknown): string[] {
  if (typeof value === "string") return value === "" ? [] : [value];
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

export function parseStopConfiguration(value: string | null): { type: string; value: string } {
  if (!value) return { type: "signal", value: "SIGTERM" };
  if (value.startsWith("^")) return { type: "signal", value: value.slice(1) };
  return { type: "command", value };
}
