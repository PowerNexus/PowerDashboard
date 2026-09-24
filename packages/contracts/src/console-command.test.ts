import { describe, expect, it } from "vitest";
import { consoleCommandTrace } from "./console-command";

describe("trace d'une commande de console", () => {
  it("garde le premier mot et compte le reste, sans le recopier", () => {
    expect(consoleCommandTrace("login hunter2-secret")).toEqual({
      command: "login",
      argumentsLength: 14,
    });
  });

  it("garde la barre oblique d'une commande de chat", () => {
    expect(consoleCommandTrace("/op Alex")).toEqual({ command: "/op", argumentsLength: 4 });
  });

  it("ignore les espaces autour, et entre le mot et ses arguments", () => {
    expect(consoleCommandTrace("  ban \t Alex  ")).toEqual({ command: "ban", argumentsLength: 4 });
  });

  it("rend une longueur nulle pour une commande sans argument", () => {
    expect(consoleCommandTrace("stop")).toEqual({ command: "stop", argumentsLength: 0 });
  });

  it("borne un premier mot démesuré", () => {
    // Un secret collé seul dans la console n'est pas un nom de commande :
    // la borne limite ce qu'il en resterait au journal.
    expect(consoleCommandTrace("x".repeat(500)).command).toHaveLength(64);
  });
});
