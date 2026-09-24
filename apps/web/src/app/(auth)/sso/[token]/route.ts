import type { NextRequest, NextResponse } from "next/server";
import { arriveByBillingLink } from "@/server/billing-link";

/** Le lien de la facturation : voir `arriveByBillingLink`. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  return arriveByBillingLink(token);
}

export const dynamic = "force-dynamic";
