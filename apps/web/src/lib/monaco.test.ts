import { describe, expect, it, vi } from "vitest";

/**
 * Monaco se charge depuis le panel, jamais depuis un CDN (NC-22).
 *
 * `@monaco-editor/react` va chercher Monaco sur `cdn.jsdelivr.net` tant
 * qu'on ne lui donne pas l'instance à employer. Ce test tient que l'éditeur
 * la lui donne, tirée de `node_modules`, avec des workers compilés par le
 * panel pour chaque service de langage.
 */

const config = vi.fn();
vi.mock("@monaco-editor/react", () => ({ loader: { config } }));
const monacoLocal = { editor: {}, languages: {} };
vi.mock("monaco-editor", () => monacoLocal);

const { monacoWorkerFor, prepareMonaco } = await import("./monaco");

describe("prepareMonaco", () => {
  it("donne au chargeur le Monaco du panel, qui ne cherche alors rien sur le réseau", async () => {
    // Deux éditeurs sur la page : une seule préparation.
    await Promise.all([prepareMonaco(), prepareMonaco()]);
    expect(config).toHaveBeenCalledOnce();
    const [{ monaco, paths }] = config.mock.calls[0] as [{ monaco: unknown; paths?: unknown }];
    expect(monaco).toMatchObject(monacoLocal);
    // Aucun chemin vers un CDN : `paths.vs` est ce qui le désigne.
    expect(paths).toBeUndefined();
  });

  it("déclare les workers, que le panel compile et sert", async () => {
    await prepareMonaco();
    const environnement = (globalThis as { MonacoEnvironment?: { getWorker?: unknown } })
      .MonacoEnvironment;
    expect(typeof environnement?.getWorker).toBe("function");
  });
});

describe("monacoWorkerFor", () => {
  it("donne à chaque service de langage son worker", () => {
    // Dès que `getWorker` existe, Monaco lui demande **tous** ses workers :
    // rendre celui de l'éditeur au service JSON ferait tomber la validation.
    expect(monacoWorkerFor("json")).toBe("json");
    for (const css of ["css", "scss", "less"]) expect(monacoWorkerFor(css)).toBe("css");
    for (const html of ["html", "handlebars", "razor"]) expect(monacoWorkerFor(html)).toBe("html");
    for (const ts of ["typescript", "javascript"]) expect(monacoWorkerFor(ts)).toBe("ts");
  });

  it("rend le worker de l'éditeur pour tout le reste", () => {
    expect(monacoWorkerFor("editorWorkerService")).toBe("editor");
    expect(monacoWorkerFor("yaml")).toBe("editor");
  });
});
