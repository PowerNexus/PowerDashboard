import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toute route qui écrit doit d'abord demander si le serveur le permet.
 *
 * `SERVER_BLOCKS` porte depuis le début la phrase « l'API s'en sert pour
 * refuser, l'interface pour ne pas proposer ». C'était vrai pour trois routes
 * sur dix. Écrire un fichier, créer une base, réserver un port ou fabriquer
 * une sauvegarde partaient sans rien demander — dans un conteneur que le
 * daemon était en train de peupler, ou sur un serveur que son hébergeur venait
 * de suspendre.
 *
 * Le daemon n'est pas un filet : il refuse `start` sur un serveur suspendu,
 * mais il fabrique volontiers sa sauvegarde. La suspension coupe l'exécution,
 * pas l'écriture.
 *
 * Le contrôle est **grossier à dessein**, comme celui des permissions : il
 * lit le texte du contrôleur et cherche deux chaînes. Un test qui
 * comprendrait le routage ne se relirait pas.
 */

const CONTROLEURS = ["server-runtime.controller.ts", "server-features.controller.ts"];

/**
 * Les permissions qui désignent une écriture.
 *
 * C'est la liste qui fait la règle : une route qui exige l'une d'elles écrit
 * quelque part, donc elle doit consulter l'état de gestion. Une route nouvelle
 * y tombe toute seule — c'est tout l'intérêt de partir des permissions plutôt
 * que d'une liste de chemins à tenir à jour.
 */
const ECRITURES = [
  "files.write",
  "files.delete",
  "files.archive",
  "backups.create",
  "backups.restore",
  "databases.create",
  "allocations.create",
];

/**
 * Exemptions, nominatives et motivées.
 *
 * Vide aujourd'hui. Elle existe pour que la première exception soit un geste
 * conscient, écrit ici avec sa raison, plutôt qu'un `requireOperable` oublié
 * qui passerait pour une décision.
 */
const EXEMPTES: Partial<Record<string, string>> = {
  /*
   * Ces deux-là exigent `files.write` — c'est la bonne permission, puisqu'on
   * ne consulte ni n'annule l'envoi de quelqu'un d'autre — mais **n'écrivent
   * rien dans le volume** : l'une lit l'état d'une session, l'autre efface des
   * morceaux gardés par le panel.
   *
   * Les bloquer serait même nuisible : pendant une installation, on veut
   * précisément pouvoir regarder où en est un envoi commencé avant, ou
   * l'abandonner pour rendre la place disque. Les trois routes qui touchent
   * réellement au volume — ouverture, morceau, assemblage — sont gardées.
   */
  "files/uploads/:uploadId": "lit l'état d'une session d'envoi, n'écrit pas dans le volume",
};

/**
 * Les blocs de chaque route.
 *
 * Le découpage s'arrête au décorateur suivant **ou à la première méthode
 * privée** : sans cette seconde borne, un utilitaire glissé entre deux routes
 * est compté dans la précédente. C'est arrivé du premier coup —
 * `requireTaskPermissions` mentionne `backups.create`, et la suppression d'un
 * sous-utilisateur passait pour une écriture non gardée.
 */
function routes(fichier: string): { chemin: string; corps: string }[] {
  const source = readFileSync(join(import.meta.dirname, fichier), "utf8");
  const decorateur = /^ {2}@(?:Get|Post|Put|Patch|Delete)\("([^"]*)"\)/gm;
  const debuts: { chemin: string; index: number }[] = [];
  for (const m of source.matchAll(decorateur)) {
    debuts.push({ chemin: m[1] ?? "", index: m.index ?? 0 });
  }
  return debuts.map((d, i) => {
    const brut = source.slice(d.index, debuts[i + 1]?.index ?? source.length);
    const prive = brut.search(/^ {2}(?:private|protected) /m);
    return { chemin: d.chemin, corps: prive === -1 ? brut : brut.slice(0, prive) };
  });
}

describe("couverture du blocage par état", () => {
  it.each(CONTROLEURS)("%s garde chacune de ses écritures", (fichier) => {
    const manquantes = routes(fichier)
      .filter(({ chemin, corps }) => {
        if (EXEMPTES[chemin]) return false;
        const ecrit = ECRITURES.some((p) => corps.includes(`"${p}"`));
        return ecrit && !corps.includes("requireOperable");
      })
      .map((r) => r.chemin);

    expect(
      manquantes,
      `Ces routes écrivent sans consulter l'état de gestion : ${manquantes.join(", ")}. ` +
        "Ajoutez `await this.access.requireOperable(id)`, ou inscrivez-les dans EXEMPTES avec leur raison.",
    ).toEqual([]);
  });

  it("ne garde pas ce qui ne fait que lire", () => {
    // L'autre moitié de la règle : un serveur suspendu se consulte. Interdire
    // la lecture empêcherait son propriétaire de récupérer ses fichiers, ou
    // même de comprendre pourquoi il est suspendu.
    const lectures = routes("server-runtime.controller.ts").filter(
      ({ corps }) => /^ {2}@Get\(/m.test(corps) && corps.includes("requireOperable"),
    );
    expect(lectures.map((r) => r.chemin)).toEqual([]);
  });
});
