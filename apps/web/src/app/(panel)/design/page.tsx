import type { Metadata } from "next";
import { DesignShowcase } from "@/components/design-showcase";

export const metadata: Metadata = { title: "Design system" };

export default function DesignPage() {
  return <DesignShowcase />;
}
