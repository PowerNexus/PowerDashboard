import { describe, expect, it } from "vitest";
import { closedSignals } from "./power-controls";

/**
 * Quels ordres d'alimentation sont fermés, et quand.
 *
 * Ce test existe à cause d'un défaut précis. Les quatre conditions vivaient
 * dispersées dans le JSX, chacune écrite à partir d'un drapeau différent. En
 * fermant les boutons pendant une installation, trois se sont fermés et le
 * quatrième — « Kill », écrit comme la **négation** d'un autre — s'est ouvert.
 *
 * La règle est donc devenue une fonction, et ce fichier l'éprouve. Un défaut
 * de ce genre ne se voit pas à la relecture : chaque ligne paraît juste
 * isolément.
 */
describe("closedSignals", () => {
  it("ferme les quatre ordres pendant un blocage", () => {
    // Installation, restauration, transfert, suspension : dans tous ces cas
    // l'API refuse. Proposer un bouton ferait cliquer puis échouer.
    const ferme = closedSignals("offline", { blocked: true });
    expect(ferme).toEqual({ start: true, restart: true, stop: true, kill: true });
  });

  it("ferme tout quand un blocage survient sur un serveur en marche", () => {
    // Le conteneur tourne, mais le panel est en train d'agir dessus : l'état
    // d'exécution ne doit rien rouvrir.
    expect(closedSignals("running", { blocked: true })).toEqual({
      start: true,
      restart: true,
      stop: true,
      kill: true,
    });
  });

  it("n'ouvre que le démarrage sur un serveur à l'arrêt", () => {
    expect(closedSignals("offline")).toEqual({
      start: false,
      restart: true,
      stop: true,
      kill: true,
    });
  });

  it("ouvre tout sauf le démarrage sur un serveur en marche", () => {
    expect(closedSignals("running")).toEqual({
      start: true,
      restart: false,
      stop: false,
      kill: false,
    });
  });

  it("laisse arrêter un démarrage qui s'éternise", () => {
    // Le seul moyen d'interrompre un démarrage bloqué. Le fermer obligerait à
    // attendre un délai d'expiration qui n'existe pas.
    const ferme = closedSignals("starting");
    expect(ferme.stop).toBe(false);
    expect(ferme.kill).toBe(false);
  });

  it("ferme tout pendant que la socket est indisponible", () => {
    // `disabled` dit « pas maintenant », `blocked` dit « pas dans cet état » :
    // deux causes distinctes, même conséquence.
    expect(closedSignals("running", { disabled: true })).toEqual({
      start: true,
      restart: true,
      stop: true,
      kill: true,
    });
  });

  it("traite une boucle de redémarrage comme un arrêt", () => {
    // `crash_loop` est déduit, jamais stocké : le serveur est bel et bien à
    // l'arrêt, et c'est le démarrage qu'on veut offrir.
    expect(closedSignals("crash_loop").start).toBe(false);
  });
});
