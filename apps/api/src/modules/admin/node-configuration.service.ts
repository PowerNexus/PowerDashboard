import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { decryptSecret, encryptSecret } from "@gamedashboard/auth";
import {
  bindingChanges,
  bindingProblem,
  buildWingsNodeConfiguration,
  type NodeBindingField,
  type NodeBindingInput,
  type WingsNodeConfiguration,
} from "@gamedashboard/contracts";
import { type Database, mounts, nodes } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * Le `config.yml` d'un node, et le remplacement de son jeton.
 *
 * **Un seul constructeur, deux rendus.** La configuration vient de
 * `buildWingsNodeConfiguration`, celui-là même que sert `wings configure` : en
 * écrire un second ici ferait qu'un node installé par la commande et un node
 * installé par le fichier ne seraient pas configurés pareil, et la première
 * rotation de jeton écraserait l'un par l'autre.
 *
 * **Ce que le JSON n'emporte pas.** Trois clés portent `json:"-"` côté Wings —
 * `system.data`, `allowed_mounts` et `remote` — et il ne les lit donc jamais
 * d'une réponse JSON, ni de `wings configure`, ni de `POST /api/update`. Elles
 * n'ont de sens que dans le fichier YAML, où elles sont bien lues. C'est
 * pourquoi le rendu YAML les complète au lieu de recopier l'objet tel quel :
 * les laisser vides dans le fichier retirerait au daemon des valeurs dont il a
 * réellement besoin.
 */

/** Délai d'attente pour joindre le daemon. Court : on est dans une requête admin. */
const DAEMON_TIMEOUT_MS = 8_000;

/**
 * Délai de chacun des deux allers-retours d'un changement de liaison.
 *
 * Deux fois quatre secondes tiennent sous les dix secondes après lesquelles
 * l'interface abandonne une action (voir `rebind`).
 */
const REBIND_STEP_MS = 4_000;

export interface NodeConfigurationFile {
  yaml: string;
  tokenId: string;
}

export interface RotationOutcome {
  /** Le daemon a écrit et appliqué la nouvelle configuration. */
  applied: boolean;
  /** Ce que le panel a retenu en base : toujours ce que le node a confirmé. */
  tokenId: string;
  /** Motif, quand le daemon n'a pas pu être joint ou a refusé. */
  failure: string | null;
}

/**
 * Issue d'un changement de liaison (adresse, protocole, ports).
 *
 * - `applied` : le daemon répond à la nouvelle liaison ; elle est enregistrée.
 * - `unchanged` : rien ne diffère de ce qui est enregistré ; rien n'est fait.
 * - `restart_required` : le daemon a écrit la nouvelle configuration mais
 *   écoute encore à l'ancienne adresse — Wings ne rouvre ses ports qu'au
 *   redémarrage. Rien n'est enregistré ; redémarrer Wings puis redemander.
 * - `refused` : le daemon n'a pas pu être mis à jour. Rien n'est enregistré ;
 *   `file` porte le `config.yml` à déposer à la main.
 */
export interface RebindOutcome {
  status: "applied" | "unchanged" | "restart_required" | "refused";
  changed: NodeBindingField[];
  failure: string | null;
  /** Le fichier à redéposer, seulement quand la poussée a échoué. Porte le jeton. */
  file: string | null;
}

/** Ce que l'écran affiche quand Wings doit redémarrer pour rouvrir ses ports. */
export const RESTART_REQUIRED_MESSAGE =
  "Le daemon a enregistré la nouvelle configuration, mais il écoute encore à l'ancienne adresse : Wings ne rouvre ses ports qu'au redémarrage. Redémarrez Wings sur la machine, puis validez à nouveau cette modification. Rien n'a été changé dans le panel en attendant.";

@Injectable()
export class NodeConfigurationService {
  private readonly logger = new Logger(NodeConfigurationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Le fichier à déposer sur la machine, jeton compris.
   *
   * Il porte le secret en clair — c'est sa raison d'être — donc il se traite
   * comme un secret : la route qui le sert est réservée à l'administration en
   * écriture, et le fichier n'a pas à traîner ailleurs que sur la machine.
   */
  async fileFor(nodeId: string): Promise<NodeConfigurationFile> {
    const node = await this.node(nodeId);
    const configuration = await this.build(node, node.tokenId, decryptSecret(node.tokenEnc));

    return { yaml: await this.toFile(configuration), tokenId: node.tokenId };
  }

  /**
   * Remplace le jeton d'un node, **en le lui remettant d'abord**.
   *
   * L'ordre est le sujet entier de cette méthode. Le jeton sert dans les deux
   * sens : le daemon s'en sert pour appeler le panel, et le panel pour appeler
   * le daemon. Les deux doivent donc changer ensemble, sans quoi le node est
   * perdu des deux côtés.
   *
   * - Écrire en base d'abord, puis pousser : si la poussée échoue, le panel a
   *   un jeton que le daemon ignore. Le node est rejeté à chaque battement de
   *   cœur, et il n'y a plus de chemin pour le corriger à distance.
   * - Pousser d'abord, puis écrire : si la réponse se perd, le daemon a le
   *   nouveau jeton et le panel l'ancien. C'est le seul cas fâcheux, et il se
   *   referme par la vérification ci-dessous.
   *
   * On pousse donc, **puis on vérifie avec le nouveau jeton**, et l'on
   * n'enregistre que ce que le node a confirmé savoir.
   */
  async rotateToken(nodeId: string): Promise<RotationOutcome> {
    const node = await this.node(nodeId);
    const tokenId = randomBytes(8).toString("hex");
    const token = randomBytes(32).toString("base64url");

    const configuration = await this.build(node, tokenId, token);
    const baseUrl = baseUrlOf(node);

    // La poussée est authentifiée par l'**ancien** jeton : c'est celui que le
    // daemon reconnaît encore au moment où on lui parle.
    const pushed = await this.push(baseUrl, decryptSecret(node.tokenEnc), configuration);

    /*
     * La vérification tranche, pas la réponse.
     *
     * Si la poussée a répondu « appliqué », ceci le confirme. Si la réponse
     * s'est perdue alors que le daemon avait déjà écrit, ceci réussit quand
     * même — et c'est précisément le cas qu'on ne saurait pas distinguer
     * autrement. Si le daemon n'a rien appliqué, ceci échoue, et l'ancien
     * jeton reste bon des deux côtés.
     */
    if (!(await this.reachable(baseUrl, token))) {
      return {
        applied: false,
        tokenId: node.tokenId,
        failure:
          pushed ??
          "Le daemon n'a pas reconnu le nouveau jeton. L'ancien reste en service : rien n'a été changé.",
      };
    }

    await this.db
      .update(nodes)
      .set({
        daemonTokenId: tokenId,
        daemonTokenEnc: encryptSecret(token),
        daemonTokenRotatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(nodes.id, nodeId));

    this.logger.log(`Jeton du node « ${node.name} » remplacé et confirmé par le daemon.`);
    return { applied: true, tokenId, failure: null };
  }

  /**
   * Change l'adresse, le protocole ou les ports d'un node, **sans le perdre**.
   *
   * Ces quatre valeurs vivent des deux côtés : en base, où le panel les lit
   * pour joindre le daemon, et dans le `config.yml` de la machine, où Wings
   * lit les ports sur lesquels écouter. Les changer d'un seul côté coupe le
   * panel de son daemon. Et Wings ne rouvre ses ports **qu'à son
   * redémarrage** : `POST /api/update` écrit le fichier et remplace la
   * configuration en mémoire, mais les serveurs HTTP et SFTP déjà lancés
   * restent sur les anciens ports. Le panel ne peut pas redémarrer Wings —
   * aucune route ne le permet, et Wings ne se modifie pas.
   *
   * D'où la règle, la même que pour la rotation du jeton : **on n'enregistre
   * que ce que le daemon a prouvé**. La preuve est une réponse authentifiée
   * par le jeton du node à la *nouvelle* adresse (le jeton est propre à cette
   * machine : une autre ne saurait pas y répondre), plus une bannière SSH au
   * nouveau port SFTP quand il change.
   *
   * 1. La nouvelle configuration est poussée **à l'ancienne adresse**, là où
   *    le daemon écoute encore.
   * 2. Puis on vérifie à la nouvelle. Réussite → enregistré (`applied`) — que
   *    la poussée ait abouti ou non : un daemon déjà redémarré sur la nouvelle
   *    adresse ne répond plus à l'ancienne, et c'est justement le cas où l'on
   *    revient valider. Échec après une poussée réussie → `restart_required`
   *    : le fichier est écrit sur la machine, Wings attend son redémarrage.
   *    Échec après une poussée ratée → `refused`, avec le fichier à déposer.
   *
   * **Deux allers-retours, pas trois, et courts.** L'interface abandonne une
   * action au bout de dix secondes (`API_TIMEOUT_MS`) ; une vérification
   * préalable, une poussée et une revérification de huit secondes chacune
   * dépassaient ce délai sur une machine injoignable, et l'écran annonçait
   * une panne de l'API au lieu du refus explicite. La vérification HTTP et la
   * bannière SSH partent en parallèle pour la même raison.
   *
   * Entre le redémarrage de Wings et la nouvelle demande, le panel ne joint
   * plus le daemon — mais le daemon, lui, joint toujours le panel (jeton et
   * adresse du panel inchangés), et ses serveurs tournent. Redemander la même
   * modification referme la fenêtre : la vérification la constate et
   * l'enregistre. Voir `docs/runbooks/modifier-liaison-node.md`.
   */
  async rebind(nodeId: string, target: NodeBindingInput): Promise<RebindOutcome> {
    const node = await this.node(nodeId);
    const problem = bindingProblem(target);
    if (problem) throw new BadRequestException(problem);

    const changed = bindingChanges(node, target);
    if (changed.length === 0) return { status: "unchanged", changed, failure: null, file: null };

    const token = decryptSecret(node.tokenEnc);
    const configuration = await this.build({ ...node, ...target }, node.tokenId, token);
    const pushed = await this.push(baseUrlOf(node), token, configuration, REBIND_STEP_MS);

    if (await this.answersAt(target, token, changed.includes("daemonSftpPort"))) {
      await this.saveBinding(node, target, changed);
      return { status: "applied", changed, failure: null, file: null };
    }

    if (pushed !== null) {
      return {
        status: "refused",
        changed,
        failure: pushed,
        file: await this.toFile(configuration),
      };
    }
    return { status: "restart_required", changed, failure: RESTART_REQUIRED_MESSAGE, file: null };
  }

  /** La nouvelle liaison répond-elle, preuve à l'appui ? */
  private async answersAt(
    target: NodeBindingInput,
    token: string,
    checkSftp: boolean,
  ): Promise<boolean> {
    const [http, ssh] = await Promise.all([
      this.reachable(baseUrlOf(target), token, REBIND_STEP_MS),
      checkSftp ? sshBannerAt(target.fqdn, target.daemonSftpPort, REBIND_STEP_MS) : true,
    ]);
    return http && ssh;
  }

  private async saveBinding(
    node: NodeRow,
    target: NodeBindingInput,
    changed: NodeBindingField[],
  ): Promise<void> {
    await this.db
      .update(nodes)
      .set({
        fqdn: target.fqdn,
        scheme: target.scheme,
        daemonPort: target.daemonPort,
        daemonSftpPort: target.daemonSftpPort,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(nodes.id, node.id));
    this.logger.log(
      `Liaison du node « ${node.name} » changée et confirmée par le daemon (${changed.join(", ")}).`,
    );
  }

  /**
   * Remet la configuration au daemon.
   *
   * Rend `null` en cas de succès, le motif sinon. Aucune exception : un node
   * injoignable est un état ordinaire de cette opération, et la vérification
   * qui suit a de toute façon le dernier mot.
   */
  private async push(
    baseUrl: string,
    currentToken: string,
    configuration: WingsNodeConfiguration,
    timeoutMs: number = DAEMON_TIMEOUT_MS,
  ): Promise<string | null> {
    try {
      const response = await fetch(`${baseUrl}/api/update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(configuration),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) return `Le daemon a refusé la mise à jour (HTTP ${response.status}).`;

      /*
       * `applied: false` est une réponse **normale**, pas une panne.
       *
       * Un node lancé avec `ignore_panel_config_updates` refuse toute
       * configuration venue du panel — c'est un choix de son administrateur.
       * Le dire tel quel évite de chercher une panne de réseau là où il n'y a
       * qu'un réglage.
       */
      const body = (await response.json()) as { applied?: boolean };
      return body.applied === true
        ? null
        : "Le daemon refuse les mises à jour venues du panel (« ignore_panel_config_updates »). Déposez le fichier à la main.";
    } catch (error) {
      const cause = error instanceof Error ? error.message : "erreur inconnue";
      return `Le daemon n'a pas répondu : ${cause}.`;
    }
  }

  /** Le daemon répond-il au jeton donné ? Seule preuve qu'il l'a bien adopté. */
  private async reachable(
    baseUrl: string,
    token: string,
    timeoutMs: number = DAEMON_TIMEOUT_MS,
  ): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/system`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async build(
    node: NodeRow,
    tokenId: string,
    token: string,
  ): Promise<WingsNodeConfiguration> {
    return buildWingsNodeConfiguration({
      id: node.id,
      fqdn: node.fqdn,
      scheme: node.scheme,
      daemonPort: node.daemonPort,
      daemonSftpPort: node.daemonSftpPort,
      tokenId,
      token,
      panelOrigin: process.env.PANEL_ORIGIN ?? "http://localhost:3000",
      appName: await this.settings.text("brand.name"),
    });
  }

  /**
   * Rend le fichier, en complétant ce que le JSON ne transporte pas.
   *
   * `allowed_mounts` est le cas qui compte : Wings refuse tout montage dont la
   * source n'y figure pas, et cette garde est la sienne. Un montage déclaré
   * dans le panel mais absent d'ici serait ignoré au démarrage, avec un simple
   * avertissement dans les journaux du node — donc invisible depuis le panel.
   */
  private async toFile(configuration: WingsNodeConfiguration): Promise<string> {
    const declared = await this.db.select({ source: mounts.source }).from(mounts);

    return toYaml({
      ...configuration,
      allowed_mounts: declared.map((row) => row.source),
      allowed_origins: [],
    });
  }

  private async node(nodeId: string): Promise<NodeRow> {
    const [row] = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        fqdn: nodes.fqdn,
        scheme: nodes.scheme,
        daemonPort: nodes.daemonPort,
        daemonSftpPort: nodes.daemonSftpPort,
        tokenId: nodes.daemonTokenId,
        tokenEnc: nodes.daemonTokenEnc,
      })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);

    if (!row) throw new NotFoundException("Node inconnu.");
    if (!row.fqdn) throw new BadRequestException("Ce node n'a pas d'adresse.");
    return row;
  }
}

/** Adresse de l'API du daemon pour une liaison donnée. */
function baseUrlOf(binding: { scheme: string; fqdn: string; daemonPort: number }): string {
  return `${binding.scheme}://${binding.fqdn}:${binding.daemonPort}`;
}

/**
 * Un serveur SSH répond-il à cette adresse ?
 *
 * Le SFTP de Wings est un serveur SSH : il annonce `SSH-2.0-…` dès la
 * connexion, avant toute authentification. C'est la seule preuve qu'on puisse
 * obtenir sans compte, et elle suffit à dire que le port écoute bien — pas
 * qu'il s'agit du bon daemon, ce que l'API authentifiée a déjà établi.
 */
export function sshBannerAt(
  host: string,
  port: number,
  timeoutMs = DAEMON_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let received = "";
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      if (received.length >= 4) finish(received.startsWith("SSH-"));
    });
    socket.on("end", () => finish(received.startsWith("SSH-")));
  });
}

interface NodeRow {
  id: string;
  name: string;
  fqdn: string;
  scheme: string;
  daemonPort: number;
  daemonSftpPort: number;
  tokenId: string;
  tokenEnc: string;
}

/**
 * Sérialise la configuration en YAML.
 *
 * Écrit à la main plutôt qu'avec une bibliothèque : le document n'a que quatre
 * formes de valeur — chaîne, nombre, booléen, liste de chaînes — et toutes les
 * chaînes sont **toujours** mises entre apostrophes. Cette règle est la raison
 * d'être de cette fonction : un jeton en base64url, un chemin, un nom de marque
 * choisi par l'administrateur n'ont pas à être devinés par un analyseur. Sans
 * guillemets, un nom valant « oui » deviendrait un booléen, et un jeton
 * commençant par un chiffre un nombre.
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    // Une liste vide s'écrit `[]` : deux lignes sans élément donneraient une
    // clé nulle, que Wings lirait comme « aucune valeur » et non « aucun
    // élément ».
    if (value.length === 0) return " []\n";
    return `\n${value.map((item) => `${pad}- ${scalar(item)}`).join("\n")}\n`;
  }

  if (value !== null && typeof value === "object") {
    let out = indent === 0 ? "" : "\n";
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const rendered =
        child !== null && typeof child === "object"
          ? toYaml(child, indent + 1)
          : ` ${scalar(child)}\n`;
      out += `${pad}${key}:${rendered}`;
    }
    return out;
  }

  return ` ${scalar(value)}\n`;
}

/** Une valeur simple, chaînes systématiquement entre apostrophes. */
function scalar(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // L'apostrophe se double à l'intérieur d'une chaîne entre apostrophes : c'est
  // le seul échappement que ce style connaisse, et il suffit.
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}
