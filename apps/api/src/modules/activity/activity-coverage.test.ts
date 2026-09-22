import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeActivity } from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";

/**
 * Tout événement consigné doit avoir un libellé.
 *
 * Le catalogue affiche un événement inconnu **sous son identifiant brut**, et
 * c'est le bon choix : le journal est en ajout seul, et masquer une ligne
 * qu'on ne sait pas nommer reviendrait à effacer une trace d'audit à
 * l'affichage. Mais ce repli est fait pour les lignes écrites par une *autre*
 * version du panel — pas pour celles que cette version écrit elle-même.
 *
 * Sans ce contrôle, ajouter une route consignée et oublier son libellé se
 * découvre en lisant le journal, c'est-à-dire le jour où l'on cherche déjà
 * autre chose. C'est arrivé aux quatre événements de fichiers ajoutés avec la
 * compression et l'envoi.
 */

const API_SOURCE = join(import.meta.dirname, "..", "..");

/** Les appels `log(request, id, "…")` et `record({ event: "…" })`. */
function eventsConsignes(directory: string): Set<string> {
  const found = new Set<string>();

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const event of eventsConsignes(full)) found.add(event);
      continue;
    }
    if (!/\.ts$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) continue;

    const source = readFileSync(full, "utf8");
    // `this.log(request, id, "files.delete", …)` — le nom est le troisième
    // argument, toujours une chaîne littérale.
    for (const m of source.matchAll(/\.log\([^,]+,[^,]+,\s*"([a-z][a-z0-9._-]+)"/g)) {
      if (m[1]) found.add(m[1]);
    }
    // `record({ event: "account.password_reset_requested", … })`
    for (const m of source.matchAll(/event:\s*"([a-z][a-z0-9._-]+)"/g)) {
      if (m[1]) found.add(m[1]);
    }
    /*
     * `this.trace(request, "application.user_created", …)` — le nom est ici le
     * **deuxième** argument, et l'aide s'appelle `trace` et non `log`.
     *
     * Ce motif manquait, et le contrôle passait donc en ignorant l'API
     * applicative entière : huit événements y étaient consignés sans libellé,
     * invisibles pour le test censé les attraper. Un contrôle de couverture qui
     * ne couvre pas tout est plus dangereux qu'aucun contrôle, puisqu'on le
     * croit exhaustif.
     */
    for (const m of source.matchAll(/\.trace\([^,]+,\s*"([a-z][a-z0-9._-]+)"/g)) {
      if (m[1]) found.add(m[1]);
    }
  }

  return found;
}

describe("couverture du journal d'activité", () => {
  it("nomme chaque événement que l'API consigne", () => {
    const sansLibelle = [...eventsConsignes(API_SOURCE)]
      .filter((event) => describeActivity(event).label === event)
      .sort();

    expect(sansLibelle).toEqual([]);
  });
});
