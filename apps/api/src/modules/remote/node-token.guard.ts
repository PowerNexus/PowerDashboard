import { tokensMatch } from "@gamedashboard/auth";
import { parseWingsAuthorization } from "@gamedashboard/contracts";
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { requestOrigin } from "../../common/request-origin";
import { decryptRowSecret } from "../../common/row-secrets";
import { DenialLogService } from "../activity/denial-log.service";
import { type NodeIdentity, NodeRepository } from "./node.repository";

/** Un identifiant de jeton de node fait seize caractères ; au-delà, on tronque. */
const MAX_TOKEN_ID = 64;

/**
 * Authentification des routes `/api/remote/*`.
 *
 * Ces routes sont appelées par Wings, jamais par un navigateur. Le garde est
 * donc entièrement distinct de celui des sessions utilisateur — les mélanger
 * ferait qu'un intergiciel de session s'appliquerait ici et répondrait par une
 * redirection vers `/login`, que le daemon traite comme une panne du panel et
 * non comme une redirection à suivre.
 *
 * Le secret est **chiffré** en base et non haché, contrairement à un mot de
 * passe. La raison n'est pas un relâchement : Wings emploie le même jeton dans
 * les deux sens, et le panel doit pouvoir le lui présenter à son tour (§7.4).
 * Un condensat rendrait tout appel sortant impossible.
 *
 * Le jeton vaut un pouvoir total sur le node (§5.5). Deux conséquences ici :
 * aucune information n'est renvoyée sur la raison d'un refus, et la comparaison
 * est à durée constante.
 */
@Injectable()
export class NodeTokenGuard implements CanActivate {
  constructor(
    @Inject(NodeRepository) private readonly nodes: NodeRepository,
    @Inject(DenialLogService) private readonly denials: DenialLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      node?: NodeIdentity;
      ip?: string;
      method?: string;
      url?: string;
      routeOptions?: { url?: string };
    }>();

    const header = request.headers.authorization;
    const token = parseWingsAuthorization(typeof header === "string" ? header : undefined);
    if (!token) {
      // Sans en-tête, rien n'a été présenté : le bruit d'Internet, déjà au
      // journal d'accès de nginx. Un en-tête illisible, lui, est une tentative.
      if (header !== undefined) this.reject(request, null, null);
      return false;
    }

    const node = await this.nodes.findByTokenId(token.id);

    // Un identifiant inconnu et un secret faux doivent coûter le même temps :
    // sans cela, la durée de réponse révèle quels identifiants existent, et il
    // devient possible de les énumérer avant d'attaquer le secret.
    const expected = node ? safeDecrypt(node.id, node.tokenSecret) : "";
    const matches = tokensMatch(expected, token.secret);

    if (!node || !matches) {
      this.reject(request, token.id, node?.id ?? null);
      return false;
    }

    /*
     * Tout appel authentifié vaut signe de vie.
     *
     * Le heartbeat ne se déduisait que de l'inventaire des serveurs, que Wings
     * ne demande qu'à son démarrage. Un daemon parfaitement vivant passait donc
     * « en retard » au bout de deux minutes, puis « injoignable », pendant
     * qu'il continuait d'envoyer ses relevés d'activité et de SFTP toutes les
     * minutes. Le panel concluait à une panne sur son propre silence.
     *
     * La garde est le seul point par lequel passent **toutes** les routes du
     * daemon : c'est donc ici que la question « ce node parle-t-il encore ? »
     * a une réponse complète. La version, elle, reste lue par la route
     * d'inventaire — elle ne change qu'au redémarrage du daemon.
     *
     * Sans attendre : l'horodatage sert à repérer un node muet, pas à dater la
     * requête en cours. Une écriture lente ne doit pas retarder la réponse.
     */
    // Le rejet est absorbé : une écriture ratée ne doit pas faire tomber le
    // processus en promesse non gérée, encore moins refuser la requête.
    void this.nodes.touch(node.id).catch(() => undefined);

    // Le node authentifié est attaché à la requête : les contrôleurs n'ont
    // ainsi aucune raison de relire l'en-tête, donc aucune occasion de refaire
    // la vérification à moitié.
    request.node = node;
    return true;
  }

  /**
   * Consigne le refus (NC-12) : un jeton volé, essayé d'ailleurs après sa
   * rotation, ne laissait aucune trace.
   *
   * L'identifiant du jeton, et le node qu'il désigne s'il existe — **jamais
   * le secret**. Sans attendre : le refus doit coûter le même temps, que
   * l'identifiant existe ou non (voir plus haut).
   */
  private reject(
    request: Parameters<typeof requestOrigin>[0],
    tokenId: string | null,
    nodeId: string | null,
  ): void {
    void this.denials.record({
      event: "node.token_rejected",
      actorId: null,
      actorType: "system",
      origin: requestOrigin(request),
      properties: { tokenId: tokenId?.slice(0, MAX_TOKEN_ID) ?? null, node: nodeId },
    });
  }
}

/**
 * Déchiffre sans propager l'échec.
 *
 * Une valeur illisible — clé changée, colonne corrompue, chiffré recopié
 * depuis la ligne d'un autre node — doit refuser la connexion, pas faire
 * tomber la requête avec une erreur 500 que le daemon réessaierait
 * indéfiniment (§7.4). La chaîne vide ne correspondra à aucun jeton présenté,
 * `parseWingsAuthorization` en refusant déjà les secrets vides.
 */
function safeDecrypt(nodeId: string, value: string): string {
  try {
    return decryptRowSecret("nodes.daemon_token_enc", nodeId, value);
  } catch {
    return "";
  }
}
