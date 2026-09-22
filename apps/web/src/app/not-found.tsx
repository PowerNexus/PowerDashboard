import { Button, EmptyState } from "@gamedashboard/ui";
import { SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <EmptyState
        icon={<SearchX />}
        title="Page introuvable"
        description="Cette page n'existe pas ou vous n'y avez pas accès."
        action={
          <Button asChild>
            <Link href="/">Retour à l'accueil</Link>
          </Button>
        }
      />
    </div>
  );
}
