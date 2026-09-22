import { createHash } from "node:crypto";
import { isUsableIdempotencyKey } from "@gamedashboard/contracts";
import { type Database, idempotencyRecords } from "@gamedashboard/db";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Rejeu sûr des créations.
 *
 * La facturation vit ailleurs, donc les appels arrivent par le réseau, avec
 * tout ce que cela suppose : une réponse perdue, une file qui réémet, un
 * humain qui reclique. Sans mémoire de ce qui a déjà été fait, chacun de ces
 * accidents crée un second serveur — facturé une fois, payé une fois, et qu'il
 * faudra retrouver à la main.
 *
 * La règle est celle des passerelles de paiement, et pour les mêmes raisons :
 * même clé, même corps ⇒ la réponse d'origine, sans rien refaire. Même clé,
 * corps différent ⇒ refus, parce que ce n'est pas une reprise mais deux
 * demandes distinctes portant la même étiquette.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Exécute `work`, ou rend la réponse déjà donnée.
   *
   * L'écriture du souvenir a lieu **après** le travail, pas avant : mémoriser
   * d'abord ferait qu'une création interrompue en plein vol laisserait une
   * clé marquée « faite » pour un serveur qui n'existe pas, et la reprise —
   * celle qui aurait réparé — se verrait refusée.
   *
   * La conséquence est assumée : deux appels vraiment simultanés peuvent tous
   * deux passer. L'unicité en base fait alors échouer le second souvenir, et
   * c'est là que `ConflictException` a lieu — l'appelant retente, et obtient
   * cette fois la réponse mémorisée.
   */
  async run<T extends Record<string, unknown>>(
    applicationKeyId: string,
    endpoint: string,
    key: string | undefined,
    body: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    /**
     * Sans clé, on exécute sans filet.
     *
     * L'exiger casserait toute intégration existante le jour de la mise en
     * service, et une API qui refuse d'agir tant qu'on ne l'a pas comprise est
     * une API qu'on contourne. La documentation la réclame, le code
     * l'encourage, rien ne l'impose.
     */
    if (key === undefined) return work();

    const trimmed = key.trim();
    if (!isUsableIdempotencyKey(trimmed)) {
      throw new BadRequestException(
        "En-tête « Idempotency-Key » inexploitable : de 8 à 200 caractères.",
      );
    }

    const requestHash = hashBody(body);

    const [existing] = await this.db
      .select({
        endpoint: idempotencyRecords.endpoint,
        requestHash: idempotencyRecords.requestHash,
        response: idempotencyRecords.response,
      })
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.applicationKeyId, applicationKeyId),
          eq(idempotencyRecords.idempotencyKey, trimmed),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.endpoint !== endpoint || existing.requestHash !== requestHash) {
        throw new ConflictException(
          "Cette clé d'idempotence a déjà servi pour une demande différente.",
        );
      }
      return existing.response as T;
    }

    const result = await work();

    try {
      await this.db.insert(idempotencyRecords).values({
        applicationKeyId,
        idempotencyKey: trimmed,
        endpoint,
        requestHash,
        response: result,
      });
    } catch {
      /**
       * Le souvenir a échoué, le travail non.
       *
       * Rendre quand même le résultat : l'appelant a bien obtenu ce qu'il
       * demandait, et une erreur ici le pousserait à retenter — c'est-à-dire à
       * créer une seconde fois, exactement ce qu'on cherche à éviter. Le cas
       * courant est une course : l'autre appel a déjà écrit.
       */
    }

    return result;
  }
}

/**
 * Condensat stable du corps.
 *
 * Les clés sont triées avant sérialisation : deux JSON équivalents dont les
 * champs sont dans un autre ordre décrivent la même demande, et les traiter
 * comme différentes ferait échouer une reprise parfaitement légitime.
 */
function hashBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(",")}}`;
}
