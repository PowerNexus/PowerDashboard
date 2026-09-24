import {
  type EngineOption,
  type InstalledEngine,
  javaMajorFor,
  pickDockerImage,
} from "@gamedashboard/contracts";
import {
  type Database,
  eggs,
  eggVariables,
  nests,
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
import { eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { WingsClientService } from "../wings/wings-client.service";
import { EngineSourcesService } from "./engine-sources";
import { EulaService } from "./eula.service";
import { isTrustedDownload, ModpackSourceService } from "./modpack-source";
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

/**
 * Mods téléchargés de front lors de l'installation d'un modpack.
 *
 * Un pack moderne compte deux à trois cents fichiers. Les demander tous d'un
 * coup ouvrirait autant de connexions sortantes depuis le node et se ferait
 * limiter en débit ; les demander un par un prendrait un quart d'heure.
 */
const PACK_CONCURRENCY = 6;

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
        current: null,
        platforms: [],
        packs: [],
      };
    }

    const packsWanted = runtime.loader === "fabric" || runtime.loader === "forge";

    const [platforms, packOptions] = await Promise.all([
      this.sources.options(runtime.loader).catch((error) => {
        this.logger.warn(`Plateformes illisibles : ${describe(error)}`);
        return [] as EngineOption[];
      }),
      packsWanted
        ? this.packs.search(query).catch((error) => {
            this.logger.warn(`Modpacks illisibles : ${describe(error)}`);
            return [] as EngineOption[];
          })
        : Promise.resolve([] as EngineOption[]),
    ]);

    return {
      runtime,
      unavailableReason: null,
      current: null,
      platforms,
      packs: packOptions,
    };
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
  ): Promise<{ label: string; files: number; eulaReset: boolean }> {
    const runtime = await this.runtimeOf(serverId);
    if (!runtime) {
      throw new BadRequestException("Le moteur de ce serveur n'a pas pu être déterminé.");
    }

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

    let installed: { label: string; files: number };
    try {
      installed = optionId.startsWith("modpack:")
        ? await this.installPack(serverId, versionId)
        : await this.installJar(serverId, optionId, versionId, runtime);
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
    _runtime: DetectedRuntime,
  ): Promise<{ label: string; files: number }> {
    const resolved = await this.sources.resolve(optionId, versionId);
    if (!resolved) {
      throw new NotFoundException("Cette version n'est plus proposée par son éditeur.");
    }

    /*
     * Le jar est posé sous le nom que **l'egg** attend, pas sous le sien.
     *
     * La commande de démarrage porte ce nom : déposer « paper-1.20.1-196.jar »
     * à côté d'un egg qui lance « server.jar » donne un serveur qui ne démarre
     * pas, avec à l'écran un moteur fraîchement installé. Le renommage n'est
     * pas un détail de confort, c'est la condition pour que ça marche.
     */
    const target = await this.jarNameOf(serverId);

    /*
     * Le runtime est vérifié **avant** d'écrire quoi que ce soit.
     *
     * Relevé sur un vrai serveur : « Minecraft 26.1 and newer requires running
     * the server with Java 25 or above ». Un egg dont l'image la plus récente
     * est Java 21 ne peut pas faire tourner cette version — et poser le jar
     * quand même donnerait un serveur cassé, avec à l'écran une installation
     * réussie. Refuser avant est la seule option qui laisse le serveur dans
     * l'état où on l'a trouvé.
     */
    const image = await this.runtimeImageFor(serverId, versionId);

    await this.wings.pullFile(serverId, "/", resolved.url, resolved.fileName);
    if (resolved.fileName !== target) {
      await this.wings.deleteFiles(serverId, "/", [target]).catch(() => undefined);
      await this.wings.renameFile(serverId, "/", resolved.fileName, target);
    }

    if (image) await this.applyRuntimeImage(serverId, image);

    return { label: `${optionId} ${versionId}`, files: 1 };
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
   * Un modpack : l'archive, puis ce qu'elle désigne, puis ses surcharges.
   *
   * Croire qu'un `.mrpack` déballé suffit donne un serveur **sans aucun mod**,
   * qui démarre — donc sans rien qui signale l'erreur. C'est le piège que cette
   * méthode existe pour éviter.
   */
  private async installPack(
    serverId: string,
    versionId: string,
  ): Promise<{ label: string; files: number }> {
    const archive = await this.packs.archiveOf(versionId);
    if (!archive) throw new NotFoundException("Cette version de modpack n'a pas d'archive.");
    // Même liste que pour les mods de l'index, lus plus bas : l'adresse de
    // l'archive vient de l'API de Modrinth, et le daemon la suivrait depuis
    // le réseau du node sans regarder.
    if (!isTrustedDownload(archive.url)) {
      this.logger.warn(`Archive de modpack refusée : ${archive.url}`);
      throw new ConflictException(
        "L'archive de ce modpack est servie depuis une adresse hors des dépôts connus. Installation refusée.",
      );
    }

    // 1. L'archive, puis son ouverture, toutes deux dans le conteneur.
    await this.wings.pullFile(serverId, "/", archive.url, archive.fileName);
    await this.wings.decompressFile(serverId, "/", archive.fileName);

    // 2. L'index, lu par le panel : quelques kilooctets, et il décide de tout.
    const raw = await this.wings.readFile(serverId, "modrinth.index.json").catch(() => "");
    const index = raw === "" ? null : this.packs.parseIndex(raw);
    if (!index) {
      throw new ConflictException(
        "L'archive ne contient pas d'index lisible. Le modpack a été déballé mais ses mods n'ont pas pu être téléchargés : vérifiez le contenu du serveur.",
      );
    }

    // 3. Chaque mod, par le daemon, borné pour ne pas saturer le node.
    let posed = 0;
    for (let i = 0; i < index.files.length; i += PACK_CONCURRENCY) {
      const slice = index.files.slice(i, i + PACK_CONCURRENCY);
      await Promise.all(
        slice.map(async (file) => {
          const url = file.downloads[0];
          if (!url) return;

          // Le chemin du pack porte le dossier ; Wings veut la racine et le nom
          // séparément.
          const at = file.path.lastIndexOf("/");
          const root = at === -1 ? "/" : `/${file.path.slice(0, at)}`;
          const name = at === -1 ? file.path : file.path.slice(at + 1);

          await this.wings.pullFile(serverId, root, url, name).catch((error) => {
            // Un mod manquant ne doit pas annuler les deux cents autres : on
            // le note et on continue, et le total rendu dira ce qui est passé.
            this.logger.warn(`Mod ${file.path} non posé : ${describe(error)}`);
          });
          posed += 1;
        }),
      );
    }

    // 4. Les surcharges : configurations du pack, à déverser à la racine.
    await this.applyOverrides(serverId);

    // 5. L'archive et l'index n'ont plus lieu d'être dans le serveur.
    await this.wings
      .deleteFiles(serverId, "/", [archive.fileName, "modrinth.index.json"])
      .catch(() => undefined);

    return { label: index.name, files: posed };
  }

  /**
   * Déplace `overrides/` à la racine du serveur.
   *
   * Ce dossier porte les fichiers de configuration que l'auteur du pack a
   * réglés : sans eux, les mods sont là mais se comportent comme s'ils
   * venaient d'être installés, ce qui n'est pas le pack qu'on a demandé.
   *
   * Entrée par entrée, parce que Wings déplace des chemins et non des
   * contenus : déplacer `overrides` lui-même donnerait un dossier `overrides`
   * à la racine, ce que le jeu ignore.
   */
  private async applyOverrides(serverId: string): Promise<void> {
    const entries = await this.wings.listDirectory(serverId, "/overrides").catch(() => []);
    if (entries.length === 0) return;

    for (const entry of entries) {
      await this.wings
        .renameFile(serverId, "/", `overrides/${entry.name}`, entry.name)
        .catch((error) => {
          this.logger.warn(`Surcharge ${entry.name} non appliquée : ${describe(error)}`);
        });
    }

    await this.wings.deleteFiles(serverId, "/", ["overrides"]).catch(() => undefined);
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
