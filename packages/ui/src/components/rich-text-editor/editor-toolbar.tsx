// Adapted from ehtisham-afzal/tiptap-shadcn basic/components/toolbars/editor-toolbar.tsx
// @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT). See third-party/tiptap-shadcn.LICENSE.
import type { ReactNode } from "react";
import { ImagePlus, Link, Minus } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { BoldToolbar } from "./bold";
import { ItalicToolbar } from "./italic";
import { HeadingsToolbar } from "./headings";
import { BlockquoteToolbar } from "./blockquote";
import { CodeBlockToolbar } from "./code-block";
import { CodeToolbar } from "./code";
import { UnderlineToolbar } from "./underline";
import { StrikeThroughToolbar } from "./strikethrough";
import { BulletListToolbar } from "./bullet-list";
import { OrderedListToolbar } from "./ordered-list";
import { UndoToolbar } from "./undo";
import { RedoToolbar } from "./redo";
import { AlignmentToolbar } from "./alignment";
import { ColorHighlightToolbar } from "./color-and-highlight";
import { SearchAndReplaceToolbar } from "./search-and-replace-toolbar";
import { useToolbar } from "./toolbar-provider";
function Group({ children }: { children: ReactNode }) { return <div className="flex max-w-full shrink-0 flex-wrap items-center gap-0.5">{children}</div>; }
// Wrap whole sections first so search/actions do not end up alone at record width.
// Each section can then wrap its smaller logical groups on narrow screens.
function Section({ children }: { children: ReactNode }) { return <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">{children}</div>; }
export function EditorToolbar({ actions, onImage, imageDisabled, onLink }: { actions?: ReactNode; onImage?(): void; imageDisabled?: boolean; onLink(): void }) {
  const { editor, labels, disabled } = useToolbar();
  return <div role="group" aria-label={labels.formatting} data-testid="editor-toolbar" className="sticky top-0 z-10 min-w-0 border-b bg-background" onMouseDown={event => { if ((event.target as HTMLElement).closest('button:not([aria-haspopup])')) event.preventDefault(); }}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
      <Section>
        <Group><UndoToolbar /><RedoToolbar /></Group>
        <Group><HeadingsToolbar /><BlockquoteToolbar /><CodeToolbar /><CodeBlockToolbar /></Group>
        <Group><BoldToolbar /><ItalicToolbar /><UnderlineToolbar /><StrikeThroughToolbar /><Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || !editor.can().setLink({ href: "https://example.com" })} aria-label={labels.link} title={labels.link} onClick={onLink}><Link /></Button></Group>
      </Section>
      <Section>
        <Group><BulletListToolbar /><OrderedListToolbar /><Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || !editor.can().setHorizontalRule()} aria-label={labels.horizontalRule} title={labels.horizontalRule} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></Button></Group>
        <Group><AlignmentToolbar />{onImage && <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || imageDisabled} aria-label={labels.image} title={labels.image} onClick={onImage}><ImagePlus /></Button>}<ColorHighlightToolbar /></Group>
        <Group><SearchAndReplaceToolbar />{actions}</Group>
      </Section>
    </div>
  </div>;
}
