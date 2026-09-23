import type { NextResponse } from "next/server";
import { beginCeremony } from "@/server/ceremony";

/**
 * Départ de « Se connecter avec Google » (PLAN §12.4, décision 4) : la même
 * cérémonie que l'annuaire, voir `beginCeremony`.
 */
export function GET(): Promise<NextResponse> {
  return beginCeremony("google");
}

/** Jamais mise en cache : chaque départ tire un état et un vérificateur neufs. */
export const dynamic = "force-dynamic";
