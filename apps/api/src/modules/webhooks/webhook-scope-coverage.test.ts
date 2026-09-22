import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tout rappel émis doit pouvoir être **adressé**.
 *
 * Un point d'entrée déclaré sur la clé d'un revendeur ne reçoit que ce qui
 * relève de lui. Encore faut-il savoir de qui relève l'événement : l'émetteur
 * le déduit de `serverId` ou de `nodeId`, et à défaut rend « la plateforme ».
 *
 * C'est le défaut silencieux qui guette : un événement qui ne porte ni l'un ni
 * l'autre part aux seules clés de la plateforme, sans erreur, sans journal. La
 * boutique d'un revendeur n'apprend simplement jamais ce qui arrive chez elle
 * — et on ne le découvre qu'en lui demandant pourquoi elle n'a pas facturé.
 *
 * Ce contrôle exige donc que chaque appel soit adressable : soit son contenu
 * désigne un serveur ou un node, soit il dit explicitement de qui il relève.
 * Il ne vérifie pas que la réponse est **juste** — aucune lecture de texte ne
 * le peut — mais qu'elle a été décidée plutôt que subie.
 */

const MODULES = join(import.meta.dirname, "..");

/** Les fichiers de l'API, en profondeur. */
function sources(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) return sources(chemin);
    return entree.isFile() && chemin.endsWith(".ts") && !chemin.endsWith(".test.ts")
      ? [chemin]
      : [];
  });
}

interface Appel {
  cle: string;
  texte: string;
}

/**
 * Isole chaque appel à `emit`, parenthèses équilibrées.
 *
 * Compter les parenthèses plutôt que chercher `});` : le contenu d'un rappel
 * porte lui-même des accolades et des appels, et s'arrêter au premier motif
 * rencontré couperait au mauvais endroit — donc validerait un appel sur la foi
 * d'un morceau du suivant.
 */
function appels(): Appel[] {
  const trouves: Appel[] = [];

  for (const fichier of sources(MODULES)) {
    const source = readFileSync(fichier, "utf8");
    const marque = "webhooks.emit(";

    let debut = source.indexOf(marque);
    while (debut !== -1) {
      let i = debut + marque.length;
      let profondeur = 1;
      while (i < source.length && profondeur > 0) {
        if (source[i] === "(") profondeur += 1;
        if (source[i] === ")") profondeur -= 1;
        i += 1;
      }

      const texte = source.slice(debut, i);
      const evenement = /emit\(\s*(?:[^"'`]*\?\s*)?["'`]([a-z_.]+)["'`]/.exec(texte);
      trouves.push({
        cle: `${fichier.slice(MODULES.length + 1)} → ${evenement?.[1] ?? "?"}`,
        texte,
      });

      debut = source.indexOf(marque, i);
    }
  }

  return trouves;
}

describe("adressage des rappels", () => {
  const tous = appels();

  it("trouve les émissions", () => {
    // Une extraction cassée rendrait le test vert sans rien vérifier : c'est le
    // mode de défaillance le plus dangereux d'un contrôle de couverture.
    expect(tous.length).toBeGreaterThan(10);
  });

  it.each(tous.map((appel) => [appel.cle, appel] as const))("%s est adressable", (cle, appel) => {
    const deductible = /\bserverId\b/.test(appel.texte) || /\bnodeId\b/.test(appel.texte);
    const explicite = /\breseller:/.test(appel.texte);

    expect(
      deductible || explicite,
      `Le rappel « ${cle} » ne porte ni « serverId » ni « nodeId », et ne dit pas ` +
        "de qui il relève. Il partira donc aux seules clés de la plateforme, " +
        "silencieusement. Ajoutez l'identifiant concerné au contenu, ou passez " +
        "« { reseller: … } » en troisième argument.",
    ).toBe(true);
  });
});
