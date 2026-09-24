// Modules de worker de Monaco : publiés sans types, et chargés pour leur seul
// effet (ils posent `onmessage`). Voir `worker.ts`.
declare module "monaco-editor/editor/editor.worker";
declare module "monaco-editor/languages/features/json/json.worker";
declare module "monaco-editor/languages/features/css/css.worker";
declare module "monaco-editor/languages/features/html/html.worker";
declare module "monaco-editor/languages/features/typescript/ts.worker";
