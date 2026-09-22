import { NextResponse } from "next/server";

/**
 * Sonde de disponibilité, à l'usage de l'écran d'erreur.
 *
 * Le navigateur ne peut pas interroger l'API directement : son adresse est
 * interne, et c'est voulu — elle n'a pas à être publique. Cette route est donc
 * le seul chemin par lequel une page peut demander « est-ce revenu ? ».
 *
 * Elle ne rend qu'un état, jamais le détail de la panne ni l'adresse tentée :
 * l'écran d'erreur, lui, tourne dans un navigateur, et ce qu'on lui confie est
 * public par construction.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Court, parce qu'on répond à quelqu'un qui attend devant un écran cassé.
 *
 * Deux secondes suffisent à distinguer « éteinte » de « revenue » ; au-delà,
 * la réponse utile est de toute façon « pas encore ».
 */
const PROBE_TIMEOUT_MS = 2_000;

export async function GET(): Promise<NextResponse> {
  try {
    const response = await fetch(`${API_URL}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return NextResponse.json({ status: "unreachable" as const }, { status: 200 });
    }

    const report = (await response.json()) as { status?: string; database?: boolean };

    /**
     * Trois états, et non deux.
     *
     * « L'API répond mais sa base est tombée » mérite son propre mot : relancer
     * l'API n'y changerait rien, et c'est pourtant ce que ferait quelqu'un à qui
     * l'on dit seulement « indisponible ».
     */
    return NextResponse.json({
      status: report.database === false ? ("degraded" as const) : ("ok" as const),
    });
  } catch {
    // La cause exacte reste côté serveur : le navigateur n'a besoin que de
    // savoir s'il peut réessayer.
    return NextResponse.json({ status: "unreachable" as const }, { status: 200 });
  }
}
