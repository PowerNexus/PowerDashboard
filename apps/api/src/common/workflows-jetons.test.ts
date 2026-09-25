import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Chaque job copie le dépôt dans son conteneur Linux (`docker cp ./.`,
 * infra/ci/linux.sh), où tournent l'installation des dépendances, la
 * compilation et les tests. actions/checkout laisse par défaut le jeton du
 * job dans .git/config : un job qui peut écrire (release, captures, CodeQL)
 * le tendait ainsi au code de ses dépendances.
 *
 * Régression : release.yml › publier (contents: write, id-token: write,
 * attestations: write) et captures.yml (contents: write) copiaient ce jeton
 * dans leur conteneur.
 */
const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const DOSSIER = join(RACINE, ".github", "workflows");
const workflows = readdirSync(DOSSIER)
  .filter((nom) => nom.endsWith(".yml"))
  .map((nom) => ({ nom, texte: readFileSync(join(DOSSIER, nom), "utf8") }));

/** Les jobs d'un workflow, chacun avec son bloc de texte. */
function jobs(texte: string) {
  const debut = texte.indexOf("\njobs:\n");
  return [...texte.slice(debut).matchAll(/^ {2}([\w-]+):\n(?: {4}.*\n|\n)*/gm)].map(
    ([bloc, nom]) => ({ nom: nom as string, bloc }),
  );
}

describe("jetons des workflows", () => {
  const ecrivains = workflows.flatMap(({ nom, texte }) =>
    jobs(texte)
      .filter(({ bloc }) => /^ {4}permissions:\n(?: {6}.*\n)*? {6}[\w-]+: write$/m.test(bloc))
      .map((job) => ({ fichier: nom, ...job })),
  );

  it("repèrent les jobs qui peuvent écrire", () => {
    const noms = ecrivains.map(({ fichier, nom }) => `${fichier}:${nom}`);
    expect(noms).toContain("release.yml:publier");
    expect(noms).toContain("captures.yml:captures");
  });

  it("ne laissent jamais le jeton d'un job qui écrit dans le dépôt copié", () => {
    for (const { fichier, nom, bloc } of ecrivains) {
      const checkouts = [
        ...bloc.matchAll(/^( +)- uses: actions\/checkout@.*\n((?:\1 {2}.*\n)*)/gm),
      ];
      expect(checkouts.length, `${fichier}:${nom}`).toBeGreaterThan(0);
      for (const [, , options] of checkouts) {
        expect(options, `${fichier}:${nom}`).toMatch(/^ +persist-credentials: false$/m);
      }
    }
  });

  it("ne donnent le jeton de push qu'à l'étape du commit des captures, sur le runner", () => {
    const captures = workflows.find(({ nom }) => nom === "captures.yml")?.texte ?? "";
    const etapes = [...captures.matchAll(/^( +)- name: .+\n(?:\1 {2}.*\n|\n)*/gm)].map(
      ([etape]) => etape,
    );
    const avecJeton = etapes.filter((etape) => etape.includes("github.token"));
    expect(avecJeton.length).toBe(1);
    const [commit] = avecJeton as [string];
    expect(commit).toContain("- name: Commiter les captures");
    // Sur le runner : l'étape ne passe pas par le conteneur.
    expect(commit).not.toContain("linux.sh");
    // En en-tête du seul push, masqué, jamais dans la configuration ni l'adresse.
    expect(commit).toContain('echo "::add-mask::$AUTORISATION"');
    expect(commit).toMatch(
      /GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http\.https:\/\/github\.com\/\.extraheader \\\n +GIT_CONFIG_VALUE_0="AUTHORIZATION: basic \$AUTORISATION" \\\n +git push origin "HEAD:\$BRANCHE"\n/,
    );
    expect(commit).not.toMatch(/git config[^\n]*(extraheader|credential)|x-access-token:[^%]/);
  });
});
