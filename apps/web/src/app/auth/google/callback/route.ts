import type { NextRequest, NextResponse } from "next/server";
import { finishCeremony } from "@/server/ceremony";

/**
 * Retour de Google : voir `finishCeremony`, où `state` est vérifié.
 *
 * C'est l'adresse à déclarer dans la console Google Cloud — l'origine du
 * panel suivie de `/auth/google/callback`, à l'identique.
 */
export function GET(request: NextRequest): Promise<NextResponse> {
  return finishCeremony("google", request);
}

export const dynamic = "force-dynamic";
