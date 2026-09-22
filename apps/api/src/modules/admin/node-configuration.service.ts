import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@gamedashboard/auth";
import { buildWingsNodeConfiguration, type WingsNodeConfiguration } from "@gamedashboard/contracts";
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
    const baseUrl = `${node.scheme}://${node.fqdn}:${node.daemonPort}`;

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
        signal: AbortSignal.timeout(DAEMON_TIMEOUT_MS),
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
  private async reachable(baseUrl: string, token: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/system`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(DAEMON_TIMEOUT_MS),
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
