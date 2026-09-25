import {
  type EngineOption,
  type InstalledEngine,
  javaMajorFor,
  type PackLoader,
  type PackSource,
  pickDockerImage,
} from "@gamedashboard/contracts";
import {
  type Database,
  eggs,
  eggVariables,
  nests,
  serverEngines,
  servers,
  serverVariables,
} from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { WingsClientService } from "../wings/wings-client.service";
import { CurseForgePackService } from "./curseforge-pack";
import { EngineSourcesService } from "./engine-sources";
import { EulaService } from "./eula.service";
import type { UpdateFound } from "./marketplace.service";
import { ModpackSourceService } from "./modpack-source";
import { PackInstallerService, type PackOutcome } from "./pack-installer.service";
import { type DetectedRuntime, detectRuntime } from "./server-runtime";

/**
 * Le moteur d'un serveur : le remplacer, qu'il s'agisse d'un jar ou d'un pack.
 *
 * Un seul service pour les deux, parce que c'est une seule opération vue de
 * deux hauteurs : on change ce que le serveur **est**. Ce qui diffère est
 * l'ampleur — un jar remplace un fichier, un modpack déverse une arborescence
 * entière — et cette différence est dite à l'utilisateur avant qu'il clique,
 * pas découverte après.
 *
 * Trois règles tiennent tout le reste :
 *
 * 1. **L'adresse n'est jamais reçue du navigateur.** Elle est résolue ici, au
 *    moment d'installer. Accepter une URL du client ferait du daemon un
 *    téléchargeur de fichiers arbitraires, pilotable par quiconque a accès à
 *    un serveur.
 * 2. **Le serveur est arrêté avant d'être touché.** Remplacer le jar d'un
 *    serveur qui tourne laisse la machine virtuelle Java sur un fichier qui
 *    n'existe plus, et le plantage n'arrive que plus tard, sans rapport visible.
 * 3. **Le panel ne relaie aucun octet.** Il résout des adresses et lit un index
 *    de quelques kilooctets ; le daemon télécharge les centaines de mégaoctets.
 */

/** Nom du jar de serveur, quand l'egg ne le déclare pas. */
const DEFAULT_JAR = "server.jar";

/** Variables d'egg où lire le nom du jar, par ordre de préférence. */
const JAR_VARIABLES = ["SERVER_JARFILE", "SERVER_JAR", "JARFILE"];

export interface EngineState {
  runtime: DetectedRuntime | null;
  /** Raison lisible quand aucun moteur ne peut être proposé. */
  unavailableReason: string | null;
  /** Ce que le serveur exécute, pour autant que le panel l'ait posé lui-même. */
  current: InstalledEngine | null;
  /** Plateformes de serveur compatibles. */
  platforms: EngineOption[];
  /** Modpacks, résultat de la recherche. */
  packs: EngineOption[];
  /**
   * Le sort de chaque catalogue de modpacks : sans lui, un CurseForge sans clé
   * et un CurseForge sans résultat donneraient le même écran.
   */
  packSources: { source: PackSource; error: string | null }[];
}

/** Ce que rend une installation, pour l'écran et le journal. */
export interface EngineInstallResult {
  label: string;
  /** Fichiers écrits. */
  files: number;
  eulaReset: boolean;
  /** Fichiers que le pack demandait et qui n'ont pas pu être posés. */
  missing: string[];
  /** Fichiers gardés tels quels : modifiés depuis la version précédente, ou au serveur. */
  kept: string[];
  /** Fichiers de la version précédente du pack retirés. */
  removed: number;
  /** Ce qui reste à faire à la main, en clair. */
  notice: string | null;
}

export interface EngineInstallOptions {
  installedBy?: string;
  /**
   * Appelé serveur arrêté et verrouillé, **avant la première écriture** :
   * c'est là que se place la sauvegarde préalable. Une erreur arrête tout.
   */
  beforeWrite?: () => Promise<void>;
}

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
    @Inject(EngineSourcesService) private readonly sources: EngineSourcesService,
    @Inject(ModpackSourceService) private readonly packs: ModpackSourceService,
    @Inject(EulaService) private readonly eula: EulaService,
    @Inject(PackInstallerService) private readonly installer: PackInstallerService,
    @Inject(CurseForgePackService) private readonly curseforge: CurseForgePackService,
  ) {}

  /**
   * Ce qui est proposable à ce serveur.
   *
   * Les modpacks ne sont offerts qu'aux chargeurs de mods : en poser un sur un
   * Paper écraserait le serveur par une arborescence qu'il ne sait pas lire.
   */
  async state(serverId: string, query: string): Promise<EngineState> {
    const runtime = await this.runtimeOf(serverId);
    if (!runtime) {
      return {
        runtime: null,
        unavailableReason:
          "Le moteur de ce serveur n'a pas pu être déterminé depuis son egg. Le panel ne propose pas de le remplacer à l'aveugle.",
        current: await this.current(serverId),
        platforms: [],
        packs: [],
        packSources: [],
      };
    }

    const packsWanted = runtime.loader === "fabric" || runtime.loader === "forge";

    const [platforms, modrinth, curseforge, current] = await Promise.all([
      this.sources.options(runtime.loader).catch((error) => {
        this.logger.warn(`Plateformes illisibles : ${describe(error)}`);
        return [] as EngineOption[];
      }),
      packsWanted ? settle(this.packs.search(query, runtime.loader)) : settle(Promise.resolve([])),
      packsWanted
        ? settle(this.curseforge.search(query, runtime.loader))
        : settle(Promise.resolve([])),
      this.current(serverId),
    ]);

    return {
      runtime,
      unavailableReason: null,
      current,
      platforms,
      packs: [...modrinth.options, ...curseforge.options],
      packSources: packsWanted
        ? [
            { source: "modrinth", error: modrinth.error },
            { source: "curseforge", error: curseforge.error },
          ]
        : [],
    };
  }

  /**
   * Ce que le panel a posé sur ce serveur, tel que la base le retient.
   *
   * `null` quand rien n'a été posé par le panel, ou depuis la dernière
   * réinstallation par le daemon : le panel ne prétend pas savoir ce qu'un
   * script d'egg a installé.
   */
  async current(serverId: string): Promise<InstalledEngine | null> {
    const [row] = await this.db
      .select()
      .from(serverEngines)
      .where(eq(serverEngines.serverId, serverId))
      .limit(1);
    if (!row) return null;

    return {
      optionId: row.optionId,
      kind: row.kind === "pack" ? "pack" : "jar",
      label: row.label,
      versionId: row.versionId,
      versionLabel: row.versionLabel,
      gameVersion: row.gameVersion,
      loader: row.loader,
      pack:
        row.packSource && row.packProjectId && isPackSource(row.packSource)
          ? { source: row.packSource, projectId: row.packProjectId }
          : null,
      trackedFiles: Object.keys(row.files ?? {}).length,
      update:
        row.latestVersionId && row.latestVersionLabel
          ? { versionId: row.latestVersionId, label: row.latestVersionLabel }
          : null,
      checkedAt: row.checkedAt,
      installedAt: row.installedAt,
    };
  }

  /**
   * Un passage de la veille pour les modpacks installés.
   *
   * Même règles que pour les extensions (`MarketplaceService.checkUpdates`) :
   * les lignes les moins récemment vérifiées d'abord, une source en panne ne
   * efface rien, et seules les mises à jour **nouvellement** apparues sont
   * rendues, pour ne prévenir qu'une fois.
   */
  async checkPackUpdates(limit: number, olderThan: string): Promise<Map<string, UpdateFound[]>> {
    const due = await this.db
      .select()
      .from(serverEngines)
      .where(
        and(
          eq(serverEngines.kind, "pack"),
          sql`(${serverEngines.checkedAt} is null or ${serverEngines.checkedAt} < now() - ${olderThan}::interval)`,
        ),
      )
      .orderBy(sql`${serverEngines.checkedAt} asc nulls first`)
      .limit(limit);

    const found = new Map<string, UpdateFound[]>();
    for (const row of due) {
      if (!row.packSource || !row.packProjectId) continue;
      const installed = {
        versionId: row.versionId,
        publishedAt: row.versionPublishedAt,
        gameVersion: row.gameVersion,
        loader: (row.loader ?? "").split(" ")[0] ?? "",
      };

      let newer: { id: string; label: string } | null;
      try {
        newer =
          row.packSource === "curseforge"
            ? await this.curseforge.newerVersion(Number(row.packProjectId), installed)
            : await this.packs.newerVersion(row.packProjectId, installed);
      } catch (error) {
        this.logger.warn(`Veille : modpack ${row.packProjectId} illisible (${describe(error)})`);
        continue;
      }

      await this.db
        .update(serverEngines)
        .set({
          latestVersionId: newer?.id ?? null,
          latestVersionLabel: newer?.label ?? null,
          checkedAt: new Date().toISOString(),
        })
        .where(eq(serverEngines.serverId, row.serverId));

      if (newer && newer.id !== row.latestVersionId) {
        const list = found.get(row.serverId) ?? [];
        list.push({ name: row.label, version: newer.label });
        found.set(row.serverId, list);
      }
    }
    return found;
  }

  /**
   * Installe un moteur : plateforme ou modpack.
   *
   * L'opération n'est **pas** réversible par elle-même : ce qui est écrasé est
   * écrasé. C'est pour cela que l'appelant doit avoir arrêté le serveur, et
   * que l'écran conseille une sauvegarde avant.
   */
  async install(
    serverId: string,
    optionId: string,
    versionId: string,
    options: EngineInstallOptions = {},
  ): Promise<EngineInstallResult> {
    const runtime = await this.runtimeOf(serverId);
    if (!runtime) {
      throw new BadRequestException("Le moteur de ce serveur n'a pas pu être déterminé.");
    }

    /*
     * Tout ce qui peut être refusé l'est **avant** d'arrêter le serveur : une
     * version introuvable, un chargeur qui ne convient pas, une archive hors
     * des dépôts connus, un runtime Java absent de l'egg. Un refus à ce stade
     * laisse le serveur tel qu'on l'a trouvé — en marche compris.
     */
    const isPack = optionId.startsWith("modpack:") || optionId.startsWith("curseforge-pack:");
    const prepared = isPack ? await this.installer.prepare(optionId, versionId, runtime) : null;
    const image = await this.runtimeImageFor(serverId, prepared?.gameVersion ?? versionId);

    /*
     * Arrêt avant écriture, et non « si possible ».
     *
     * Remplacer le jar d'un serveur qui tourne laisse la machine virtuelle sur
     * un fichier supprimé : le serveur continue quelques minutes, puis tombe
     * pour une raison qui n'a plus aucun rapport visible avec ce qu'on a fait.
     */
    await this.wings.power(serverId, "stop").catch(() => undefined);

    /*
     * Le serveur est marqué « en installation » pendant toute l'opération.
     *
     * Sans cela, rien n'empêchait de cliquer « Démarrer » dans la console
     * pendant que le panel remplaçait le jar : le daemon aurait lancé un
     * programme à moitié écrit, et la panne qui suit ne ressemble en rien à sa
     * cause. `ServerAccessService.requireOperable` lit cet état et refuse, avec
     * la raison.
     *
     * Relâché dans un `finally` : une installation qui échoue doit rendre le
     * serveur à son propriétaire, pas le laisser verrouillé.
     */
    await this.setState(serverId, "installing");

    let installed: Omit<EngineInstallResult, "eulaReset">;
    try {
      // La sauvegarde préalable voit un serveur arrêté, que personne ne peut
      // redémarrer pendant qu'elle se fait.
      if (options.beforeWrite) await options.beforeWrite();

      if (prepared) {
        const previous = await this.trackedPackFiles(serverId);
        const outcome = await this.installer.run(
          serverId,
          prepared,
          runtime,
          previous,
          (loader, gameVersion) => this.installLoader(serverId, loader, gameVersion),
        );
        if (image) await this.applyRuntimeImage(serverId, image);
        await this.recordPack(serverId, optionId, outcome, options.installedBy);
        installed = {
          label: outcome.record.label,
          files: outcome.written,
          missing: outcome.missing,
          kept: outcome.kept,
          removed: outcome.removed,
          notice: outcome.notice,
        };
      } else {
        installed = await this.installJar(
          serverId,
          optionId,
          versionId,
          image,
          options.installedBy,
        );
      }
    } finally {
      await this.setState(serverId, null);
    }

    /*
     * L'acceptation du contrat de licence est retirée.
     *
     * Un accord se donne pour **un** programme. Ce serveur n'exécute plus le
     * même : le faire démarrer sur un consentement donné pour l'ancien moteur
     * ferait reposer la conformité d'aujourd'hui sur une décision prise pour
     * autre chose. Le redemander coûte un clic.
     *
     * Après l'installation, jamais avant : une installation qui échoue ne doit
     * pas retirer un accord toujours valable pour le moteur en place.
     */
    const eulaReset = await this.eula.reset(serverId, `moteur remplacé par ${installed.label}`);

    return { ...installed, eulaReset };
  }

  /** Fichiers suivis du pack en place, vides si le moteur actuel n'en est pas un. */
  private async trackedPackFiles(serverId: string): Promise<Record<string, string>> {
    const [row] = await this.db
      .select({ kind: serverEngines.kind, files: serverEngines.files })
      .from(serverEngines)
      .where(eq(serverEngines.serverId, serverId))
      .limit(1);
    return row?.kind === "pack" ? (row.files ?? {}) : {};
  }

  /**
   * Retient ce qui vient d'être installé.
   *
   * La veille repart de zéro (`checked_at` nul) : la ligne est vérifiée à son
   * prochain passage, sans garder la « mise à jour disponible » d'une version
   * qu'on vient peut-être justement d'installer.
   */
  private async record(
    serverId: string,
    values: Omit<typeof serverEngines.$inferInsert, "serverId" | "installedAt">,
  ): Promise<void> {
    const now = new Date().toISOString();
    const row = {
      ...values,
      latestVersionId: null,
      latestVersionLabel: null,
      checkedAt: null,
      installedAt: now,
      updatedAt: now,
    };
    await this.db
      .insert(serverEngines)
      .values({ serverId, ...row })
      .onConflictDoUpdate({ target: serverEngines.serverId, set: row });
  }

  private recordPack(
    serverId: string,
    optionId: string,
    outcome: PackOutcome,
    installedBy: string | undefined,
  ): Promise<void> {
    const { record } = outcome;
    return this.record(serverId, {
      kind: "pack",
      optionId: optionId.slice(0, 160),
      label: record.label.slice(0, 200),
      versionId: record.versionId.slice(0, 120),
      versionLabel: record.versionLabel.slice(0, 200),
      versionPublishedAt: record.publishedAt,
      gameVersion: record.gameVersion.slice(0, 40),
      loader: record.loader?.slice(0, 80) ?? null,
      packSource: record.source,
      packProjectId: record.projectId.slice(0, 120),
      files: record.files,
      installedBy: installedBy ?? null,
    });
  }

  /**
   * Le chargeur demandé par le pack.
   *
   * **Fabric** : le serveur est posé à la version de Fabric Loader que le pack
   * demande, sous le nom que l'egg attend — c'était la marche manquante, le
   * pack se déballait sur le chargeur en place quelle que soit sa version.
   * **Forge et NeoForge** : ils ne publient qu'un installeur, qui doit tourner
   * dans le conteneur (`ENGINE_EXCLUSIONS`) ; le panel ne le lance pas, et le
   * dit plutôt que de laisser croire que c'est fait. Rend ce message, ou `null`.
   */
  private async installLoader(
    serverId: string,
    loader: { loader: PackLoader; version: string } | null,
    gameVersion: string,
  ): Promise<string | null> {
    if (!loader) return null;
    if (loader.loader === "fabric") {
      if (gameVersion === "") return null;
      const jar = await this.sources.fabricServer(gameVersion, loader.version).catch(() => null);
      if (!jar) {
        return `Fabric Loader ${loader.version} pour Minecraft ${gameVersion} est introuvable chez Fabric : le chargeur en place a été gardé.`;
      }
      await this.placeJar(serverId, jar);
      return null;
    }
    const name = loader.loader === "neoforge" ? "NeoForge" : "Forge";
    return `Ce pack demande ${name}${loader.version ? ` ${loader.version}` : ""}${gameVersion ? ` pour Minecraft ${gameVersion}` : ""}. Le panel ne lance pas l'installeur de ${name} : vérifiez que l'egg de ce serveur installe cette version, et réinstallez-le depuis les paramètres si besoin.`;
  }

  /**
   * Pose ou lève l'état de gestion du serveur.
   *
   * `null` veut dire « rien de particulier » : c'est l'état d'un serveur
   * installé, à l'arrêt ou en marche. Le panel n'y écrit jamais l'état du
   * conteneur, que seul le daemon connaît (§8.2).
   *
   * Un arrêt brutal du panel pendant une installation laisse le serveur
   * verrouillé — c'est la même exposition que le flux d'installation d'origine,
   * et `resetTransientStates` le libère au prochain démarrage du daemon.
   */
  private async setState(serverId: string, state: "installing" | null): Promise<void> {
    await this.db
      .update(servers)
      .set({ state, updatedAt: new Date().toISOString() })
      .where(eq(servers.id, serverId));
  }

  /** Une plateforme : un fichier, posé sous le nom que l'egg attend. */
  private async installJar(
    serverId: string,
    optionId: string,
    versionId: string,
    image: string | null,
    installedBy: string | undefined,
  ): Promise<Omit<EngineInstallResult, "eulaReset">> {
    const resolved = await this.sources.resolve(optionId, versionId);
    if (!resolved) {
      throw new NotFoundException("Cette version n'est plus proposée par son éditeur.");
    }

    await this.placeJar(serverId, resolved);
    if (image) await this.applyRuntimeImage(serverId, image);

    const label = this.sources.labelOf(optionId);
    await this.record(serverId, {
      kind: "jar",
      optionId: optionId.slice(0, 160),
      label: label.slice(0, 200),
      versionId: versionId.slice(0, 120),
      versionLabel: versionId.slice(0, 200),
      versionPublishedAt: null,
      gameVersion: optionId === "paper:velocity" ? "" : versionId.slice(0, 40),
      loader: null,
      packSource: null,
      packProjectId: null,
      files: {},
      installedBy: installedBy ?? null,
    });

    return {
      label: `${label} ${versionId}`,
      files: 1,
      missing: [],
      kept: [],
      removed: 0,
      notice: null,
    };
  }

  /**
   * Pose un jar de serveur sous le nom que **l'egg** attend, pas sous le sien.
   *
   * La commande de démarrage porte ce nom : déposer « paper-1.20.1-196.jar »
   * à côté d'un egg qui lance « server.jar » donne un serveur qui ne démarre
   * pas, avec à l'écran un moteur fraîchement installé. Le renommage n'est
   * pas un détail de confort, c'est la condition pour que ça marche.
   */
  private async placeJar(
    serverId: string,
    resolved: { url: string; fileName: string },
  ): Promise<void> {
    const target = await this.jarNameOf(serverId);
    await this.wings.pullFile(serverId, "/", resolved.url, resolved.fileName);
    if (resolved.fileName !== target) {
      await this.wings.deleteFiles(serverId, "/", [target]).catch(() => undefined);
      await this.wings.renameFile(serverId, "/", resolved.fileName, target);
    }
  }

  /**
   * Aligne l'image de conteneur sur la version installée.
   *
   * **Relevé sur un vrai serveur, et c'est la dernière marche.** Poser un jar
   * Paper 1.21 sur un egg réglé en Java 8 donne un fichier parfaitement en
   * place et un conteneur qui sort en code 1 : « Minecraft requires running the
   * server with Java 17 or above ». Changer le moteur sans changer le runtime
   * ne change rien d'utile — pire, cela donne l'impression que l'installation a
   * marché.
   *
   * L'image est choisie **parmi celles que l'egg déclare**, jamais fabriquée :
   * son auteur les a éprouvées, et en inventer une ferait tirer au daemon une
   * adresse qui n'existe pas. Quand aucune ne convient, on n'y touche pas et on
   * le dit au journal — un serveur qui ne démarre pas se diagnostique ; un
   * serveur basculé sur un runtime arbitraire, beaucoup moins.
   */
  private async runtimeImageFor(serverId: string, gameVersion: string): Promise<string | null> {
    const java = javaMajorFor(gameVersion);
    // Version illisible : on ne bascule rien, et on ne refuse rien non plus.
    // Deviner corrigerait un problème que le serveur n'avait peut-être pas.
    if (java === null) return null;

    const [row] = await this.db
      .select({ images: eggs.dockerImages, current: servers.dockerImage })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) return null;

    const wanted = pickDockerImage((row.images ?? {}) as Record<string, string>, java);

    /*
     * **Refus, et non repli silencieux.**
     *
     * Aucune image de l'egg ne porte ce Java : cette version ne peut pas
     * tourner ici. Poser le jar quand même donnerait un serveur cassé avec,
     * à l'écran, une installation réussie — le pire des deux mondes. Le refus
     * nomme la version de Java manquante, qui est la seule information utile à
     * qui doit corriger l'egg.
     */
    if (!wanted) {
      throw new ConflictException(
        `Cette version demande Java ${java}, et l'egg de ce serveur ne déclare aucune image qui le porte. ` +
          "Ajoutez-en une au catalogue, ou choisissez une version plus ancienne.",
      );
    }

    return wanted === row.current ? null : wanted;
  }

  /**
   * Bascule le serveur sur l'image retenue, et prévient le daemon.
   *
   * Wings ne relit la configuration qu'au démarrage et sur `syncServer` : sans
   * cet appel, il redémarrerait le serveur sur l'ancienne image, et le jar
   * fraîchement posé échouerait pour une raison qu'on croirait corrigée.
   */
  private async applyRuntimeImage(serverId: string, image: string): Promise<void> {
    await this.db
      .update(servers)
      .set({ dockerImage: image, updatedAt: new Date().toISOString() })
      .where(eq(servers.id, serverId));

    await this.wings.syncServer(serverId).catch(() => undefined);
    this.logger.log(`Serveur ${serverId} basculé sur ${image}.`);
  }

  /**
   * Nom du jar attendu par l'egg du serveur.
   *
   * Lu dans ses variables, avec `server.jar` en repli — c'est la convention de
   * la quasi-totalité des eggs, et se tromper donne un serveur qui ne démarre
   * pas plutôt qu'une erreur.
   */
  private async jarNameOf(serverId: string): Promise<string> {
    const variables = await this.db
      .select({ name: eggVariables.envVariable, value: serverVariables.value })
      .from(serverVariables)
      .innerJoin(eggVariables, eq(serverVariables.eggVariableId, eggVariables.id))
      .where(eq(serverVariables.serverId, serverId));

    const found = variables.find(
      (variable) => JAR_VARIABLES.includes(variable.name) && variable.value.trim() !== "",
    );
    return found?.value.trim() ?? DEFAULT_JAR;
  }

  /** Runtime du serveur, déduit de son egg et de ses variables. */
  private async runtimeOf(serverId: string): Promise<DetectedRuntime | null> {
    const [row] = await this.db
      .select({ eggName: eggs.name, nestName: nests.name })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) return null;

    const variables = await this.db
      .select({ name: eggVariables.envVariable, value: serverVariables.value })
      .from(serverVariables)
      .innerJoin(eggVariables, eq(serverVariables.eggVariableId, eggVariables.id))
      .where(eq(serverVariables.serverId, serverId));

    const merged = Object.fromEntries(variables.map((v) => [v.name, v.value])) as Record<
      string,
      string
    >;

    return detectRuntime(row.eggName, row.nestName, merged);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPackSource(value: string): value is PackSource {
  return value === "modrinth" || value === "curseforge";
}

/** Une recherche de packs et son sort, pour pouvoir dire pourquoi elle est vide. */
async function settle(
  pending: Promise<EngineOption[]>,
): Promise<{ options: EngineOption[]; error: string | null }> {
  try {
    return { options: await pending, error: null };
  } catch (error) {
    return { options: [], error: describe(error) };
  }
}
