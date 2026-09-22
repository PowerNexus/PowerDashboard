import {
  type Database,
  eggs,
  eggVariables,
  nests,
  servers,
  serverVariables,
} from "@gamedashboard/db";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { WingsClientService, WingsUnavailableError } from "../wings/wings-client.service";
import { detectRuntime } from "./server-runtime";

/**
 * Le contrat de licence de Minecraft, et qui l'accepte.
 *
 * Un serveur Minecraft refuse de démarrer tant que `eula.txt` ne porte pas
 * `eula=true`. C'est délibéré de la part de Mojang : le fichier **est** l'acte
 * d'acceptation d'un contrat, pas un réglage technique.
 *
 * D'où la seule règle qui gouverne ce service : **le panel n'accepte jamais
 * tout seul**. Écrire ce fichier à la création d'un serveur, ou au premier
 * démarrage raté, ferait signer un contrat au nom de quelqu'un qui ne l'a pas
 * lu — et un contrat accepté sans que personne ne l'ait voulu n'engage rien de
 * solide.
 *
 * Trois conséquences dans le code :
 *
 * 1. L'écriture n'a lieu que sur une demande explicite, et elle exige
 *    `files.write` — la même permission que déposer n'importe quel fichier.
 * 2. Qui a accepté et quand sont inscrits au journal d'activité par la route :
 *    un contrat accepté sans trace de son signataire ne vaut rien.
 * 3. Rien de tout cela n'est proposé hors d'un serveur Minecraft, où le fichier
 *    n'aurait aucun sens.
 */

/** Le fichier, tel que le serveur le cherche. */
const EULA_FILE = "eula.txt";

/** L'adresse que Mojang impose de citer, et que l'écran doit donner à lire. */
export const MINECRAFT_EULA_URL = "https://aka.ms/MinecraftEULA";

export interface EulaState {
  /** Ce serveur est-il concerné ? Faux hors Minecraft. */
  applicable: boolean;
  /** `eula.txt` porte-t-il `eula=true` ? `null` quand le fichier est illisible. */
  accepted: boolean | null;
  url: string;
}

@Injectable()
export class EulaService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
  ) {}

  async state(serverId: string): Promise<EulaState> {
    if (!(await this.isMinecraft(serverId))) {
      return { applicable: false, accepted: null, url: MINECRAFT_EULA_URL };
    }

    /*
     * Trois issues, et elles étaient deux de trop à se ressembler.
     *
     * **Fichier absent** : le serveur crée `eula.txt` à son premier démarrage
     * raté ; avant cela il n'existe pas et Wings répond en erreur. C'est
     * l'état normal d'un serveur neuf, et `false` — « pas accepté » — est
     * exactement ce qu'il faut dire à l'écran.
     *
     * **Daemon muet** : la machine est tombée. On ne sait *rien* du fichier.
     * Le `catch` renvoyait `""` dans ce cas aussi, donc `accepted: false`, et
     * le panel affichait un bandeau orange réclamant d'accepter une licence —
     * alors que le problème était que la machine ne répondait plus. On a vu
     * ce bandeau sur un serveur dont le node était arrêté : il accusait le
     * client de ne pas avoir accepté un contrat, et cachait la vraie panne
     * dans une ligne rouge en petits caractères.
     *
     * `null` dit « on ne sait pas », l'écran se tait, et la panne réelle est
     * annoncée par ce qui la connaît : l'état de la machine.
     */
    let raw: string;
    try {
      raw = await this.wings.readFile(serverId, EULA_FILE);
    } catch (error) {
      // `status === null` : aucune réponse du tout. Un code HTTP, même 404,
      // veut dire que le daemon a répondu — donc que le fichier n'est pas là.
      const injoignable = error instanceof WingsUnavailableError && error.status === null;
      if (injoignable) return { applicable: true, accepted: null, url: MINECRAFT_EULA_URL };
      raw = "";
    }

    return {
      applicable: true,
      accepted: /^\s*eula\s*=\s*true\s*$/im.test(raw),
      url: MINECRAFT_EULA_URL,
    };
  }

  /**
   * Refuse le démarrage tant que le contrat n'est pas accepté.
   *
   * **Empêcher plutôt que constater.** Le serveur démarrait, écrivait « You
   * need to agree to the EULA » dans sa console, puis s'arrêtait : il fallait
   * lire une ligne perdue au milieu d'un journal pour comprendre, et le panel
   * courait après ce message pour le détecter. Refuser en amont supprime le
   * problème au lieu de l'observer — et la raison arrive là où l'on a cliqué,
   * pas dans un flux qu'on ne regardait peut-être pas.
   *
   * Le fichier fait foi, pas une colonne : quelqu'un peut l'avoir accepté en
   * SFTP, ou l'avoir remis à `false` à la main. C'est ce que le serveur lira au
   * démarrage, donc c'est ce que nous devons lire pour décider.
   */
  async requireAccepted(serverId: string): Promise<void> {
    const state = await this.state(serverId);
    if (!state.applicable || state.accepted !== false) return;

    throw new ConflictException(
      "Le contrat de licence de Minecraft n'est pas accepté : ce serveur refuserait de démarrer. " +
        "Acceptez-le depuis le bandeau en haut de cette page.",
    );
  }

  /**
   * Écrit l'acceptation.
   *
   * Le fichier est réécrit en entier, avec un commentaire qui dit **quand** et
   * **par quel moyen** il a été posé. Un `eula=true` nu, des mois plus tard, ne
   * dirait pas s'il vient du panel, d'un éditeur SFTP ou d'un script.
   *
   * L'identité du signataire n'est pas dans le fichier mais au journal : un
   * fichier du conteneur est modifiable par le client, la trace d'activité non.
   */
  async accept(serverId: string): Promise<void> {
    if (!(await this.isMinecraft(serverId))) {
      throw new BadRequestException("Ce serveur n'est pas un serveur Minecraft.");
    }

    const stamp = new Date().toISOString();
    await this.wings.writeFile(
      serverId,
      EULA_FILE,
      [
        `# Accepté depuis le panel GameDashboard le ${stamp}.`,
        `# ${MINECRAFT_EULA_URL}`,
        "eula=true",
        "",
      ].join("\n"),
    );
  }

  /**
   * Retire l'acceptation, parce que ce qui tourne n'est plus le même.
   *
   * Un accord se donne pour **un** programme. Remplacer Paper par un modpack,
   * ou monter de version, change ce que le serveur exécute : l'accord donné
   * pour l'ancien ne couvre pas le nouveau. Le redemander coûte un clic et
   * garde la trace honnête — la laisser courir ferait reposer le démarrage
   * d'aujourd'hui sur un consentement donné il y a six mois pour autre chose.
   *
   * Le fichier est écrit à `false` plutôt que supprimé, et c'est délibéré : un
   * fichier absent se confond avec un serveur neuf, là où un `false` daté dit
   * **pourquoi** l'acceptation a été retirée. Quelqu'un qui ouvre `eula.txt`
   * en SFTP doit pouvoir le comprendre sans nous demander.
   *
   * Rend `true` quand l'acceptation a effectivement été retirée, pour que
   * l'appelant puisse en garder trace au journal.
   */
  async reset(serverId: string, reason: string): Promise<boolean> {
    if (!(await this.isMinecraft(serverId))) return false;

    const stamp = new Date().toISOString();
    await this.wings
      .writeFile(
        serverId,
        EULA_FILE,
        [
          `# Acceptation retirée le ${stamp} : ${reason}.`,
          "# Le serveur ne démarrera pas tant que le contrat n'aura pas été accepté à nouveau.",
          `# ${MINECRAFT_EULA_URL}`,
          "eula=false",
          "",
        ].join("\n"),
      )
      // Un daemon muet ne doit pas faire échouer l'installation qui vient de
      // réussir : l'acceptation reste alors celle d'avant, ce qui est moins
      // grave qu'un moteur installé à moitié.
      .catch(() => undefined);

    return true;
  }

  /**
   * Le serveur tourne-t-il sous Minecraft ?
   *
   * Déduit de l'egg par la même heuristique que le catalogue d'extensions, et
   * non d'une colonne : le panel n'en a pas, et les eggs de Pterodactyl ne
   * déclarent pas leur jeu. Quand elle ne conclut pas, on ne propose rien —
   * plutôt que d'écrire un fichier au hasard dans le conteneur.
   */
  private async isMinecraft(serverId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ eggName: eggs.name, nestName: nests.name })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!row) return false;

    const variables = await this.db
      .select({ name: eggVariables.envVariable, value: serverVariables.value })
      .from(serverVariables)
      .innerJoin(eggVariables, eq(serverVariables.eggVariableId, eggVariables.id))
      .where(eq(serverVariables.serverId, serverId));

    const runtime = detectRuntime(
      row.eggName,
      row.nestName,
      Object.fromEntries(variables.map((v) => [v.name, v.value])),
    );

    return runtime?.game === "minecraft";
  }
}
