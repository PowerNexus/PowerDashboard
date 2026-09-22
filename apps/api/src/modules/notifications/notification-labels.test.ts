import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOTIFICATION_EVENTS } from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";

/**
 * Chaque type de notification doit avoir son libellé, dans les deux langues.
 *
 * L'écran des préférences liste le catalogue et traduit chaque ligne par
 * `notificationPrefs.event.<préfixe>.<suffixe>`. Un type ajouté sans son
 * libellé ne casse rien au démarrage : il produit un `MISSING_MESSAGE` à
 * l'exécution, sur la page qu'on ouvre précisément pour régler ses
 * notifications. **C'est déjà arrivé.**
 *
 * Le contrôle vit ici parce que le paquet web n'exécute aucun test, et que le
 * paquet `contracts` n'a pas à connaître les catalogues de traduction. Il lit
 * les deux sources plutôt que de recopier la liste : une troisième copie aurait
 * exactement le défaut qu'on surveille.
 *
 * Il éprouve aussi la **forme** de la clé : `next-intl` découpe sur les points,
 * si bien qu'une entrée plate `"schedule.failed": "…"` posée dans le bloc
 * `event` serait introuvable — le piège le plus fréquent de ce dépôt.
 */

const RACINE = join(import.meta.dirname, "..", "..", "..", "..", "..");
const CATALOGUES = ["fr", "en"] as const;

function labels(langue: string): Record<string, unknown> {
  const source = readFileSync(
    join(RACINE, "packages", "i18n", "src", "messages", `${langue}.json`),
    "utf8",
  );
  const tout = JSON.parse(source) as Record<string, Record<string, Record<string, unknown>>>;
  return tout.notificationPrefs?.event ?? {};
}

describe("libellés des notifications", () => {
  for (const langue of CATALOGUES) {
    it(`couvre tous les types du catalogue en ${langue}`, () => {
      const event = labels(langue);

      const absents = NOTIFICATION_EVENTS.filter(({ type }) => {
        const [prefixe, suffixe] = type.split(".");
        const bloc = prefixe ? event[prefixe] : undefined;
        if (typeof bloc !== "object" || bloc === null) return true;
        return typeof (bloc as Record<string, unknown>)[suffixe ?? ""] !== "string";
      }).map((e) => e.type);

      expect(absents).toEqual([]);
    });

    it(`n'emploie aucune clé pointée en ${langue}`, () => {
      // Une clé contenant un point à ce niveau est inatteignable : `next-intl`
      // la chercherait comme un chemin, et trouverait un bloc manquant.
      const pointees = Object.keys(labels(langue)).filter((cle) => cle.includes("."));
      expect(pointees).toEqual([]);
    });
  }
});
