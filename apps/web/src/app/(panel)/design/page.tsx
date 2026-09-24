import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignShowcase } from "@/components/design-showcase";
import { showcaseServed } from "@/lib/design-showcase";

export const metadata: Metadata = { title: "Design system" };

/** Vitrine des composants, en développement seulement (`lib/design-showcase.ts`). */
export default function DesignPage() {
  if (!showcaseServed()) notFound();
  return <DesignShowcase />;
}
