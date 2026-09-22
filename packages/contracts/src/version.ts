/**
 * Comparaison de versions du daemon Wings, au format « 0.4.2 ».
 *
 * Renvoie une valeur négative si `a` précède `b`, zéro si les deux sont
 * équivalentes, positive sinon.
 *
 * Chaque segment est réduit à son premier groupe de chiffres, ce qui absorbe
 * les préfixes (« v1.0.0 », « forge 0.4.2 ») et les suffixes (« 1.0.0-rc1 »).
 * Un segment sans aucun chiffre compte pour zéro : sans cette précaution la
 * soustraction produirait `NaN`, et comme `NaN < 0` est faux, un node en retard
 * de version passerait silencieusement pour à jour.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) =>
    version.split(".").map((part) => {
      const digits = part.match(/\d+/);
      return digits ? Number.parseInt(digits[0], 10) : 0;
    });

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version la plus récente d'une liste. Chaîne vide si la liste est vide. */
export function latestVersion(versions: readonly string[]): string {
  return versions.reduce((best, current) => {
    if (best === "") return current;
    return compareVersions(current, best) > 0 ? current : best;
  }, "");
}

/** Vrai si `version` est antérieure à `reference`. */
export function isOutdated(version: string, reference: string): boolean {
  return compareVersions(version, reference) < 0;
}
