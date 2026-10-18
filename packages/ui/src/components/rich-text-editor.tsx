"use client";
// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type UseEditorOptions } from "@tiptap/react";
import { TooltipProvider } from "@tabdo/ui/components/tooltip";
import { createRichTextExtensions } from "@tabdo/ui/lib/rich-text-extensions";
import { ToolbarProvider } from "./rich-text-editor/toolbar-provider";
import { EditorToolbar } from "./rich-text-editor/editor-toolbar";
import { FloatingToolbar } from "./rich-text-editor/floating-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tabdo/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Input } from "@tabdo/ui/components/input";
import { Button } from "@tabdo/ui/components/button";

export type RichTextLabels = {
  insertFormat: string; formatting: string; selectionFormatting: string;
  bold: string; italic: string; heading(level: number): string; bulletList: string; orderedList: string; quote: string; codeBlock: string;
  link: string; image: string; undo: string; redo: string; close: string; linkHint: string; url: string; applyLink: string; removeLink: string;
};
export type RichTextEditorInstance = Editor;
export function useRichTextEditor({ isAllowedUri, ...options }: Partial<UseEditorOptions> & { isAllowedUri(href: string): boolean }) {
  const extensions = useMemo(() => createRichTextExtensions(isAllowedUri), [isAllowedUri]);
  return useEditor({ ...options, extensions, immediatelyRender: false, editorProps: { ...options.editorProps, attributes: { class: "rich-text-prose", ...(typeof options.editorProps?.attributes === "object" ? options.editorProps.attributes : {}) } } });
}
export function RichTextEditor({ editor, labels, disabled, actions, onImage, imageDisabled, imageSources = {}, isAllowedUri }: { editor: Editor | null; labels: RichTextLabels; disabled?: boolean; actions?: ReactNode; onImage?(): void; imageDisabled?: boolean; imageSources?: Record<string, string>; isAllowedUri(href: string): boolean }) {
  const root = useRef<HTMLDivElement>(null), id = useId();
  const [linkOpen, setLinkOpen] = useState(false), [link, setLink] = useState("");
  // Upstream toolbars read editor state through their provider; transactions refresh active/can state.
  useEditorState({ editor, selector: ({ editor }) => editor ? {
    from: editor.state.selection.from, to: editor.state.selection.to,
    active: ["bold", "italic", "bulletList", "orderedList", "blockquote", "codeBlock", "link"].map(name => editor.isActive(name)),
    headings: [1, 2, 3].map(level => editor.isActive("heading", { level })),
    undo: editor.can().undo(), redo: editor.can().redo(),
  } : null });
  if (!editor) return null;
  const openLink = () => { setLink(editor.getAttributes("link").href ?? ""); setLinkOpen(true); };
  return <div ref={root} data-rich-text-editor className="min-w-0">
    <ToolbarProvider editor={editor} labels={labels} disabled={disabled}><TooltipProvider>
      <EditorToolbar actions={actions} onImage={onImage} imageDisabled={imageDisabled} onLink={openLink} />
      <FloatingToolbar root={root} onLink={openLink} suppress={linkOpen} />
      <EditorContent editor={editor} className="min-w-0 cursor-text py-3" />
    </TooltipProvider></ToolbarProvider>
    <div hidden aria-hidden="true">{Object.entries(imageSources).map(([id, url]) => <img key={id} data-private-source={id} src={url} alt="" />)}</div>
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent closeLabel={labels.close} onCloseAutoFocus={event => { event.preventDefault(); editor.commands.focus(); }}><DialogHeader><DialogTitle>{labels.link}</DialogTitle><DialogDescription>{labels.linkHint}</DialogDescription></DialogHeader><form noValidate onSubmit={event => { event.preventDefault(); if (link && !isAllowedUri(link)) return; const chain = editor.chain().focus().extendMarkRange("link"); if (link) chain.setLink({ href: link }).run(); else chain.unsetLink().run(); setLinkOpen(false); }}><FieldGroup><Field><FieldLabel htmlFor={id}>{labels.url}</FieldLabel><Input id={id} value={link} aria-invalid={!!link && !isAllowedUri(link)} onChange={event => setLink(event.target.value)} autoFocus /></Field><Button type="submit" disabled={!!link && !isAllowedUri(link)}>{link ? labels.applyLink : labels.removeLink}</Button></FieldGroup></form></DialogContent></Dialog>
  </div>;
}
