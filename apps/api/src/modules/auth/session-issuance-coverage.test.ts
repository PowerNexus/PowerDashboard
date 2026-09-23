import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toute session s'ouvre par `SessionIssuerService`, ou par la prise en main.
 *
 * C'est là que se trouve le refus des comptes suspendus. Un contrôleur qui
 * appellerait `SessionRepository.create` directement — un nouveau fournisseur
 * d'identité, un lien magique — ouvrirait une porte que la suspension ne
 * fermerait pas. `SessionRepository.resolve` la refermerait à la requête
 * suivante, mais la session aurait été émise, et le client verrait « connecté »
 * avant d'être rejeté : ce test l'empêche à la source.
 *
 * La prise en main est la seule exception, et elle a sa propre garde
 * (`AdminActionsService.impersonationTarget` refuse un compte suspendu).
 */

const API_SOURCE = join(import.meta.dirname, "..", "..");

/** Les seuls fichiers autorisés à fabriquer une session. */
const ALLOWED = new Set([
  "modules/auth/session-issuer.service.ts",
  "modules/admin/admin.controller.ts",
]);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

describe("ouverture des sessions", () => {
  it("ne passe que par le fabricant unique, qui refuse les comptes suspendus", () => {
    const offenders = sources(API_SOURCE)
      .map((file) => ({ file: relative(API_SOURCE, file), source: readFileSync(file, "utf8") }))
      .filter(({ source }) => /\bsessions\.create\(/.test(source))
      .map(({ file }) => file)
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });

  it("n'écrit dans la table des sessions que depuis son dépôt", () => {
    const writers = sources(API_SOURCE)
      .map((file) => ({ file: relative(API_SOURCE, file), source: readFileSync(file, "utf8") }))
      .filter(({ source }) => /\.insert\(sessions\)/.test(source))
      .map(({ file }) => file);

    expect(writers).toEqual(["modules/auth/session.repository.ts"]);
  });
});
