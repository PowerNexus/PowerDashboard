import { describe, expect, it } from "vitest";
import { APPLICATION_ROUTES, type ApiRoute, CLIENT_ROUTES, SESSION_ROUTES } from "./api-catalogue";
import { buildOpenApiDocument } from "./openapi";

/**
 * Le catalogue est lu par deux choses qui ne se parlent pas.
 *
 * L'écran « API » en fait une liste, et React exige des clés uniques : une
 * route déclarée deux fois y produit un avertissement, puis des lignes
 * dupliquées ou manquantes. Le générateur OpenAPI, lui, indexe par chemin :
 * le second passage **écrase** le premier sans rien dire, et la
 * spécification perd un résumé sans que le compte de routes bouge.
 *
 * C'est arrivé : `POST /servers/{server}/files/compress` figurait deux fois,
 * avec deux résumés différents. Seul l'écran l'a signalé, et seulement une
 * fois ouvert.
 */

const FAMILLES: [string, ApiRoute[]][] = [
  ["session", SESSION_ROUTES],
  ["client", CLIENT_ROUTES],
  ["application", APPLICATION_ROUTES],
];

describe("catalogue des routes", () => {
  it.each(FAMILLES)("%s ne déclare aucune route deux fois", (_nom, routes) => {
    const vues = new Map<string, number>();
    for (const route of routes) {
      const cle = `${route.method} ${route.path}`;
      vues.set(cle, (vues.get(cle) ?? 0) + 1);
    }

    const doublons = [...vues.entries()].filter(([, n]) => n > 1).map(([cle]) => cle);
    expect(
      doublons,
      `Ces routes sont déclarées plusieurs fois : ${doublons.join(", ")}. ` +
        "Gardez la déclaration la plus précise et retirez l'autre.",
    ).toEqual([]);
  });

  it.each(FAMILLES)("%s écrit des chemins exploitables", (_nom, routes) => {
    for (const route of routes) {
      // Un chemin sans barre initiale se collerait au préfixe de sa famille et
      // donnerait `/api/v1/clientservers`.
      expect(route.path.startsWith("/"), `« ${route.path} » ne commence pas par /`).toBe(true);
      // Un gabarit non refermé sort tel quel dans la spécification, et les
      // outils le rejettent sans expliquer lequel.
      const ouverts = (route.path.match(/\{/g) ?? []).length;
      const fermes = (route.path.match(/\}/g) ?? []).length;
      expect(ouverts, `gabarits mal formés dans « ${route.path} »`).toBe(fermes);
      expect(route.summary.trim(), `« ${route.path} » n'a pas de résumé`).not.toBe("");
    }
  });

  it("produit une spécification dont chaque opération est identifiable", () => {
    // Un générateur de client nomme ses méthodes d'après `operationId` : deux
    // identiques et l'une des deux méthodes disparaît du client produit.
    const document = buildOpenApiDocument();
    const identifiants = Object.values(document.paths).flatMap((operations) =>
      Object.values(operations).map((operation) => operation.operationId),
    );

    expect(new Set(identifiants).size).toBe(identifiants.length);
  });

  it("ne laisse aucune requête collée dans un chemin", () => {
    // Le catalogue écrit parfois `/files?directory={x}` pour le lecteur ; la
    // spécification doit séparer les deux, sans quoi le chemin n'en est plus un.
    const document = buildOpenApiDocument();
    expect(Object.keys(document.paths).filter((chemin) => chemin.includes("?"))).toEqual([]);
  });
});
