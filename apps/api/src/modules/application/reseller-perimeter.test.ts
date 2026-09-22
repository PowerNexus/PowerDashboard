import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Aucune route de l'API applicative ne peut ignorer le périmètre de sa clé.
 *
 * Une clé de revendeur dit sur **qui** elle porte, en plus de dire ce qu'elle
 * peut faire. Mais ce périmètre ne s'applique que là où une route pense à le
 * demander : `ResellerScopeService` a beau le documenter longuement, il ne
 * s'exécute pas tout seul. Quatre routes l'avaient oublié — la modification et
 * la suppression d'un compte, la liste des serveurs et la lecture de l'un
 * d'eux. La première permettait de renommer le client d'un confrère, la
 * dernière de lire tout le parc de la plateforme.
 *
 * Rien ne l'aurait signalé : le typage est satisfait, les tests passaient, et
 * l'écran des clés affichait fièrement un périmètre que la moitié de l'API ne
 * regardait pas. C'est exactement ce que ce contrôle refuse désormais — non pas
 * que le périmètre soit **correct**, ce qu'aucune lecture de texte ne peut
 * dire, mais qu'il ait été **envisagé**. Une route qui n'en veut pas doit
 * l'écrire ci-dessous, avec sa raison.
 *
 * Le test lit le contrôleur en texte, comme les autres contrôles de couverture
 * de ce dépôt : recopier la liste des routes ailleurs aurait précisément le
 * défaut qu'on surveille.
 */

/**
 * Tous les contrôleurs qui acceptent une clé applicative.
 *
 * Le second est facile à oublier justement parce qu'il n'a qu'une route — et
 * c'est celle qui rend le jeton du daemon.
 */
const CONTROLEURS = ["application.controller.ts", "node-configuration.controller.ts"];

/**
 * Les marques qui prouvent qu'une route a pensé au périmètre.
 *
 * Soit elle le vérifie elle-même, soit elle le transmet au service qui
 * l'appliquera en SQL. Les deux comptent : borner en base vaut mieux que
 * filtrer après coup, et exiger l'une des deux formes seulement pousserait à
 * écrire la mauvaise.
 */
const PREUVES = ["this.scope.require", "@PlatformOnly(", "request.application.resellerId"];

/**
 * Les routes qui n'ont volontairement aucun périmètre, et pourquoi.
 *
 * La raison n'est pas décorative : c'est elle qui rend la dispense relisible.
 * Ajouter une ligne ici doit coûter un argument, sinon la liste devient le
 * trou qu'elle est censée documenter.
 */
const SANS_PERIMETRE: Record<string, string> = {
  "GET identity":
    "Décrit la clé elle-même. Elle ne lit aucune donnée de personne, et un " +
    "périmètre n'aurait rien à restreindre.",
  "POST users":
    "Un compte tout neuf n'est à personne — le rattachement se lit sur les " +
    "serveurs, et il n'en a pas encore. L'attribuer au revendeur qui le crée " +
    "serait une propriété que le modèle ne reconnaît pas.",
  "GET locations":
    "Le catalogue de la plateforme, identique pour tous. Les localisations ne " +
    "disent rien de qui héberge quoi ; c'est `GET nodes`, borné lui, qui dit " +
    "où un revendeur peut placer.",
  "GET plans":
    "Les offres sont celles de la plateforme et ne nomment aucun client. Un " +
    "revendeur s'en sert comme d'un gabarit de quantités sur ses propres " +
    "machines.",
  "GET eggs":
    "La liste des jeux activés. Elle ne dépend de personne, et la borner " +
    "n'aurait aucun sens : un revendeur installe les mêmes jeux que nous.",
};

interface Route {
  cle: string;
  corps: string;
}

/**
 * Découpe le contrôleur en routes.
 *
 * Chaque route commence à son décorateur de méthode HTTP et court jusqu'au
 * suivant : tout ce qui la concerne — les autres décorateurs, la signature, le
 * corps — se trouve donc dans sa tranche.
 */
function routesDe(fichier: string): Route[] {
  const source = readFileSync(join(import.meta.dirname, fichier), "utf8");
  const decorateur = /^ {2}@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/gm;

  const trouvees: { cle: string; debut: number }[] = [];
  let match = decorateur.exec(source);
  while (match !== null) {
    const chemin = (match[2] ?? "").replace(/["'`]/g, "").trim();
    trouvees.push({
      // Le décorateur s'écrit « Get », la clé se lit « GET » : c'est un verbe
      // HTTP, et l'écrire autrement dans les dispenses se relirait mal.
      cle: `${(match[1] ?? "").toUpperCase()} ${chemin === "" ? "/" : chemin}`,
      debut: match.index,
    });
    match = decorateur.exec(source);
  }

  return trouvees.map((route, i) => ({
    cle: route.cle,
    corps: source.slice(route.debut, trouvees[i + 1]?.debut ?? source.length),
  }));
}

function routes(): Route[] {
  return CONTROLEURS.flatMap(routesDe);
}

describe("périmètre revendeur de l'API applicative", () => {
  const toutes = routes();

  it("trouve les routes du contrôleur", () => {
    // Un découpage cassé rendrait le test vert sans rien vérifier : c'est le
    // mode de défaillance le plus dangereux d'un contrôle de couverture.
    expect(toutes.length).toBeGreaterThan(15);
  });

  it.each(toutes.map((route) => [route.cle, route] as const))(
    "%s déclare son périmètre",
    (cle, route) => {
      if (cle in SANS_PERIMETRE) {
        expect(SANS_PERIMETRE[cle]?.length ?? 0).toBeGreaterThan(40);
        return;
      }

      const declare = PREUVES.some((preuve) => route.corps.includes(preuve));
      expect(
        declare,
        `La route « ${cle} » n'applique aucun périmètre et n'est pas dispensée. ` +
          "Vérifiez-le par « this.scope.require… », transmettez " +
          "« request.application.resellerId » au service, ou inscrivez la route " +
          "dans SANS_PERIMETRE avec la raison.",
      ).toBe(true);
    },
  );

  it("ne dispense que des routes qui existent", () => {
    // Une dispense qui ne correspond plus à rien est pire qu'inutile : elle
    // couvrirait la prochaine route qui prendrait le même nom.
    const existantes = new Set(toutes.map((route) => route.cle));
    for (const cle of Object.keys(SANS_PERIMETRE)) {
      expect(existantes, `La dispense « ${cle} » ne correspond à aucune route.`).toContain(cle);
    }
  });
});
