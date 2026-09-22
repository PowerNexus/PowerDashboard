"use client";

import { Skeleton } from "@gamedashboard/ui";
import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
  sh: "shell",
  bash: "shell",
  toml: "ini",
  ini: "ini",
  properties: "ini",
  cfg: "ini",
  md: "markdown",
  log: "plaintext",
  txt: "plaintext",
  lua: "lua",
  java: "java",
  xml: "xml",
  html: "html",
  css: "css",
};

export function languageForFile(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}

export interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  height?: number | string;
  readOnly?: boolean;
}

/**
 * Éditeur Monaco aux couleurs du panel. Le thème suit celui de l'application
 * et `Ctrl+S` déclenche `onSave` au lieu de la boîte d'enregistrement du navigateur.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  onSave,
  height = 560,
  readOnly,
}: CodeEditorProps) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const explicit = root.getAttribute("data-theme");
      setDark(
        explicit === "dark" ||
          (explicit === null && window.matchMedia("(prefers-color-scheme: dark)").matches),
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", read);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <Editor
        height={height}
        language={language}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        theme={dark ? "gamedashboard-dark" : "gamedashboard-light"}
        loading={<Skeleton className="h-full w-full rounded-none" />}
        beforeMount={(monaco) => {
          monaco.editor.defineTheme("gamedashboard-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": "#0b0d13",
              "editorGutter.background": "#0b0d13",
              "editorLineNumber.foreground": "#4b5563",
              "editorLineNumber.activeForeground": "#8b5cf6",
              "editor.lineHighlightBackground": "#161922",
              "editorCursor.foreground": "#8b5cf6",
              "editor.selectionBackground": "#7c3aed55",
            },
          });
          monaco.editor.defineTheme("gamedashboard-light", {
            base: "vs",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": "#ffffff",
              "editorLineNumber.activeForeground": "#7c3aed",
              "editorCursor.foreground": "#7c3aed",
              "editor.selectionBackground": "#7c3aed33",
            },
          });
        }}
        onMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave?.());
        }}
        options={{
          readOnly,
          fontFamily: "var(--gd-font-mono)",
          fontSize: 13,
          lineHeight: 22,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          renderWhitespace: "selection",
          tabSize: 2,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}
