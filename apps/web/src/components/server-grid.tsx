"use client";

import { formatMb, ServerCard } from "@gamedashboard/ui";
import Link from "next/link";
import { useState } from "react";
import type { ServerCardData } from "@/lib/server-view";

/** Grille de cartes serveur. Le favori est local en phase 2, il passera par l'API ensuite. */
export function ServerGrid({ servers }: { servers: ServerCardData[] }) {
  const [favorites, setFavorites] = useState<Record<string, boolean>>(
    Object.fromEntries(servers.map((s) => [s.id, s.isFavorite])),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {servers.map((s) => (
        <ServerCard
          key={s.id}
          name={s.name}
          shortId={s.shortId}
          state={s.state}
          address={s.address}
          nodeName={s.nodeName}
          cpuPct={s.cpuPct ?? 0}
          memoryLabel={ratio(s.memoryMb, s.memoryMaxMb)}
          diskLabel={ratio(s.diskMb, s.diskMaxMb)}
          playersLabel={s.players === null ? "—" : `${s.players} / ${s.maxPlayers ?? "?"}`}
          isFavorite={favorites[s.id]}
          onToggleFavorite={() => setFavorites((f) => ({ ...f, [s.id]: !f[s.id] }))}
          as={({ className, children }) => (
            <Link href={`/server/${s.id}`} className={className}>
              {children}
            </Link>
          )}
        />
      ))}
    </div>
  );
}

/**
 * « — / 4 Go » quand la consommation est inconnue.
 *
 * Écrire « 0 Go / 4 Go » affirmerait que rien n'est consommé, alors que la
 * mesure n'est simplement pas parvenue. La capacité, elle, est connue et reste
 * affichée.
 */
function ratio(used: number | null, max: number): string {
  return `${used === null ? "—" : formatMb(used, 1)} / ${formatMb(max, 1)}`;
}
