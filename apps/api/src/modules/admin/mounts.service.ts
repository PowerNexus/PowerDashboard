import { posix } from "node:path";
import { type Database, mounts, serverMounts, servers } from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { WingsClientService } from "../wings/wings-client.service";

/**
 * Racines de l'hôte qu'aucun montage ne peut désigner, ni elles ni ce
 * qu'elles contiennent. Le socket Docker vaut root sur la machine ; le reste
 * livre la configuration, les secrets ou les données des autres serveurs.
 */
const FORBIDDEN_MOUNT_SOURCES = [
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var/lib/docker",
  "/var/lib/pterodactyl",
  "/var/run",
] as const;

/** Longueur maximale d'un chemin sous Linux (`PATH_MAX`). */
const PATH_MAX = 4096;

/**
 * Le chemin est-il écrit sous sa forme simple ?
 *
 * Docker résout `//etc`, `/./etc` ou `/var//lib/docker` comme `/etc` et
 * `/var/lib/docker` : comparer la forme écrite aux racines interdites les
 * laissait passer. Plutôt que de corriger la saisie en silence, on la refuse,
 * pour que la table (et donc `allowed_mounts`) ne garde que la forme simple.
 * Une barre finale est tolérée.
 */
function isSimplePath(path: string): boolean {
  const sansBarreFinale = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return sansBarreFinale !== "" && posix.normalize(sansBarreFinale) === sansBarreFinale;
}

/**
 * Dossiers de la machine hôte partagés avec des conteneurs.
 *
 * C'est la façon de partager une carte, un jeu de données ou un fichier de
 * configuration entre plusieurs serveurs sans le recopier dans chacun.
 *
 * **Deux barrières, et la seconde ne nous appartient pas.** Le panel décide
 * quels montages existent et à quels serveurs ils sont attachés ; le daemon,
 * lui, refuse tout montage dont la source ne figure pas dans son propre
 * `allowed_mounts` — relevé dans sa source, `server/mounts.go`. Un panel
 * compromis ne peut donc pas exposer `/etc` à un conteneur : l'administrateur
 * de la machine garde le dernier mot, et c'est ainsi qu'il faut le laisser.
 *
 * La première barrière reste la nôtre, et elle mérite d'être serrée : un
 * montage en écriture donne au serveur de jeu le droit de modifier ce que ses
 * voisins lisent.
 */

export interface MountView {
  id: string;
  name: string;
  source: string;
  target: string;
  readOnly: boolean;
  /** Un montage non « attachable par le client » ne s'ajoute que par l'administration. */
  userMountable: boolean;
  /** Serveurs auxquels il est attaché : décide de ce qu'une suppression retire. */
  servers: number;
}

export interface MountInput {
  name: string;
  source: string;
  target: string;
  readOnly: boolean;
  userMountable: boolean;
}

@Injectable()
export class MountsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
  ) {}

  async list(): Promise<MountView[]> {
    return this.db
      .select({
        id: mounts.id,
        name: mounts.name,
        source: mounts.source,
        target: mounts.target,
        readOnly: mounts.readOnly,
        userMountable: mounts.userMountable,
        servers: count(serverMounts.serverId),
      })
      .from(mounts)
      .leftJoin(serverMounts, eq(serverMounts.mountId, mounts.id))
      .groupBy(mounts.id);
  }

  /** Montages d'un serveur, avec ceux qu'on pourrait encore lui attacher. */
  async forServer(serverId: string): Promise<{ attached: MountView[]; available: MountView[] }> {
    const all = await this.list();
    const rows = await this.db
      .select({ mountId: serverMounts.mountId })
      .from(serverMounts)
      .where(eq(serverMounts.serverId, serverId));

    const attachedIds = new Set(rows.map((row) => row.mountId));
    return {
      attached: all.filter((mount) => attachedIds.has(mount.id)),
      available: all.filter((mount) => !attachedIds.has(mount.id)),
    };
  }

  async create(input: MountInput): Promise<MountView> {
    this.validate(input);

    const [row] = await this.db
      .insert(mounts)
      .values({
        name: input.name.trim(),
        source: input.source.trim(),
        target: input.target.trim(),
        readOnly: input.readOnly,
        userMountable: input.userMountable,
      })
      .returning({ id: mounts.id });

    if (!row) throw new ServiceUnavailableException("Montage non enregistré.");
    return this.mustFind(row.id);
  }

  /**
   * Modifie un montage.
   *
   * Les serveurs qui le portent ne sont **pas** resynchronisés ici : un
   * changement de source ou de cible ne prend effet qu'au prochain démarrage
   * du conteneur, puisqu'un montage se pose à sa création. Prévenir le daemon
   * donnerait l'illusion d'un effet immédiat que Docker ne permet pas.
   */
  async update(id: string, input: MountInput): Promise<MountView> {
    this.validate(input);
    await this.mustFind(id);

    await this.db
      .update(mounts)
      .set({
        name: input.name.trim(),
        source: input.source.trim(),
        target: input.target.trim(),
        readOnly: input.readOnly,
        userMountable: input.userMountable,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(mounts.id, id));

    return this.mustFind(id);
  }

  /**
   * Supprime un montage.
   *
   * Refusé tant qu'il est attaché à un serveur. La suppression en cascade
   * existe en base, mais elle retirerait silencieusement un dossier partagé à
   * des serveurs qui l'utilisent — et l'on ne s'en apercevrait qu'au prochain
   * démarrage, quand le jeu ne trouverait plus ses cartes.
   */
  async remove(id: string): Promise<void> {
    const mount = await this.mustFind(id);
    if (mount.servers > 0) {
      throw new ConflictException(
        `Ce montage est attaché à ${mount.servers} serveur(s). Détachez-le avant de le supprimer.`,
      );
    }

    await this.db.delete(mounts).where(eq(mounts.id, id));
  }

  /**
   * Attache un montage à un serveur.
   *
   * Le daemon est prévenu, mais **le montage n'apparaîtra qu'au prochain
   * démarrage** : un point de montage se pose à la création du conteneur, et
   * aucun ordre ne l'ajoute à un conteneur qui tourne. L'appelant le dit à
   * l'écran plutôt que de laisser chercher pourquoi le dossier est absent.
   */
  async attach(serverId: string, mountId: string): Promise<void> {
    await this.mustFind(mountId);
    await this.mustFindServer(serverId);

    await this.db
      .insert(serverMounts)
      .values({ serverId, mountId })
      // Attacher deux fois n'est pas une erreur : c'est déjà l'état demandé.
      .onConflictDoNothing();

    await this.sync(serverId);
  }

  async detach(serverId: string, mountId: string): Promise<void> {
    await this.db
      .delete(serverMounts)
      .where(and(eq(serverMounts.serverId, serverId), eq(serverMounts.mountId, mountId)));

    await this.sync(serverId);
  }

  /**
   * Contrôle des chemins.
   *
   * Absolus tous les deux : un chemin relatif serait résolu par Docker depuis
   * un répertoire courant que personne ne maîtrise, et pointerait ailleurs
   * selon la façon dont le daemon a été lancé.
   *
   * La cible ne peut pas être la racine du serveur : `/home/container` est déjà
   * le montage par défaut, et le recouvrir masquerait tous ses fichiers — le
   * serveur démarrerait sur un disque vide, sans que rien ne dise pourquoi.
   */
  private validate(input: MountInput): void {
    if (input.name.trim() === "") throw new BadRequestException("Nom manquant.");

    const source = input.source.trim();
    const target = input.target.trim();

    // Borne posée avant toute expression régulière : un chemin d'un mégaoctet
    // rendait quadratique le retrait des barres finales.
    if (source.length > PATH_MAX || target.length > PATH_MAX) {
      throw new BadRequestException("Chemin trop long.");
    }
    if (!source.startsWith("/")) {
      throw new BadRequestException("La source doit être un chemin absolu de la machine hôte.");
    }
    if (!target.startsWith("/")) {
      throw new BadRequestException("La cible doit être un chemin absolu dans le conteneur.");
    }
    if (target.replace(/\/+$/, "") === "/home/container") {
      throw new BadRequestException(
        "La cible ne peut pas être la racine du serveur : elle masquerait tous ses fichiers.",
      );
    }
    if (source.includes("..") || target.includes("..")) {
      throw new BadRequestException("Les chemins ne peuvent pas contenir « .. ».");
    }
    if (!isSimplePath(source) || !isSimplePath(target)) {
      throw new BadRequestException(
        "Écrivez les chemins sous leur forme simple, sans « // » ni « /./ » : Docker lit « //etc » comme « /etc ».",
      );
    }

    /*
     * La source ne peut pas être l'hôte lui-même.
     *
     * `allowed_mounts` du daemon est généré depuis cette table : la garde de
     * Wings n'est donc plus une seconde barrière, c'est celle-ci. Monter `/`,
     * `/etc` ou le socket Docker dans un conteneur en donne le contrôle de
     * la machine à qui y a une console.
     */
    const normalized = source.replace(/\/+$/, "") || "/";
    const forbidden = FORBIDDEN_MOUNT_SOURCES.find(
      (root) => normalized === root || normalized.startsWith(`${root}/`),
    );
    if (forbidden !== undefined) {
      throw new BadRequestException(
        `La source « ${source} » n'est pas montable : elle donnerait accès à la machine hôte.`,
      );
    }
  }

  /**
   * Prévient le daemon d'un changement.
   *
   * L'échec n'annule rien : la base fait foi, et le daemon relit sa
   * configuration au démarrage suivant — c'est-à-dire au moment précis où le
   * montage prendrait effet de toute façon.
   */
  private async sync(serverId: string): Promise<void> {
    await this.wings.syncServer(serverId).catch(() => undefined);
  }

  private async mustFind(id: string): Promise<MountView> {
    const found = (await this.list()).find((mount) => mount.id === id);
    if (!found) throw new NotFoundException("Montage introuvable.");
    return found;
  }

  private async mustFindServer(serverId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) throw new NotFoundException("Serveur introuvable.");
  }
}
