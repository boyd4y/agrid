import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import * as React from "react";
import { Annotation, Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { yaml } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";
import { cn } from "@tabdo/ui/lib/utils";

export type CodeEditorLanguage = "text" | "html" | "css" | "markdown" | "python" | "json" | "javascript" | "typescript" | "yaml";
export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  language?: CodeEditorLanguage;
  filename?: string;
  className?: string;
  "aria-label"?: string;
}
function languageFor(filename = ""): CodeEditorLanguage {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "html" || extension === "htm" || extension === "svg") return "html";
  if (extension === "css") return "css";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "py") return "python";
  if (extension === "json") return "json";
  if (extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs") return "javascript";
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (extension === "yaml" || extension === "yml") return "yaml";
  return "text";
}
function languageExtension(language: CodeEditorLanguage, filename?: string): Extension {
  switch (language) {
    case "html": return html();
    case "css": return css();
    case "markdown": return markdown();
    case "python": return python();
    case "json": return json();
    case "javascript": return javascript({ jsx: filename?.endsWith(".jsx") });
    case "typescript": return javascript({ typescript: true, jsx: filename?.endsWith(".tsx") });
    case "yaml": return yaml();
    default: return [];
  }
}
const externalValue = Annotation.define<boolean>();
const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--foreground)", backgroundColor: "var(--background)", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", lineHeight: "1.6" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": { color: "var(--muted-foreground)", backgroundColor: "var(--muted)", borderRight: "1px solid var(--border)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 25%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)" },
  ".cm-panels": { color: "var(--foreground)", backgroundColor: "var(--muted)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-textfield, .cm-button": { color: "var(--foreground)", background: "var(--background)", border: "1px solid var(--input)", borderRadius: "var(--radius)", padding: "3px 6px", font: "inherit" },
  ".cm-tooltip": { color: "var(--popover-foreground)", backgroundColor: "var(--popover)", border: "1px solid var(--border)" },
});
const highlight = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.heading], color: "var(--primary)" },
  { tag: [tags.string, tags.regexp], color: "var(--success)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--warning)" },
  { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.typeName, tags.className], color: "var(--primary)" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, textDecoration: "underline" },
]));

/** Controlled file editor. Search remains available in read-only mode. */
export function CodeEditor({ value, onChange, readOnly = false, language, filename, className, "aria-label": label = "Code editor" }: CodeEditorProps) {
  const host = React.useRef<HTMLDivElement>(null), view = React.useRef<EditorView | null>(null);
  const props = React.useRef({ value, onChange, readOnly, label, language, filename });
  props.current = { value, onChange, readOnly, label, language, filename };
  const compartments = React.useRef({ language: new Compartment(), access: new Compartment() });
  React.useEffect(() => {
    const current = props.current, slots = compartments.current;
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: current.value, extensions: [
      lineNumbers(), highlightActiveLineGutter(), history(), drawSelection(), bracketMatching(), indentOnInput(), highlightSelectionMatches(), theme, highlight,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      slots.language.of(languageExtension(current.language ?? languageFor(current.filename), current.filename)),
      slots.access.of([EditorState.readOnly.of(current.readOnly), EditorView.contentAttributes.of({ "aria-label": current.label, "aria-readonly": String(current.readOnly) })]),
      EditorView.updateListener.of(update => { if (update.docChanged && update.transactions.some(transaction => !transaction.annotation(externalValue))) props.current.onChange?.(update.state.doc.toString()); }),
    ] }) });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, []);
  React.useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: [externalValue.of(true), Transaction.addToHistory.of(false)] });
  }, [value]);
  React.useEffect(() => { view.current?.dispatch({ effects: compartments.current.language.reconfigure(languageExtension(language ?? languageFor(filename), filename)) }); }, [language, filename]);
  React.useEffect(() => { view.current?.dispatch({ effects: compartments.current.access.reconfigure([EditorState.readOnly.of(readOnly), EditorView.contentAttributes.of({ "aria-label": label, "aria-readonly": String(readOnly) })]) }); }, [readOnly, label]);
  return <div ref={host} data-slot="code-editor" className={cn("h-96 min-h-0 min-w-0 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring", className)} />;
}
