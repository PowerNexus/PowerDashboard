import type { NextRequest, NextResponse } from "next/server";
import { finishCeremony } from "@/server/ceremony";

/** Retour de l'annuaire : voir `finishCeremony`, où `state` est vérifié. */
export function GET(request: NextRequest): Promise<NextResponse> {
  return finishCeremony("sso", request);
}

export const dynamic = "force-dynamic";
