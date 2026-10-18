// Adapted from ehtisham-afzal/tiptap-shadcn basic/components/toolbars/editor-toolbar.tsx
// @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT). See third-party/tiptap-shadcn.LICENSE.
import type { ReactNode } from "react";
import { ImagePlus, Link, Minus } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { ScrollArea, ScrollBar } from "@tabdo/ui/components/scroll-area";
import { Separator } from "@tabdo/ui/components/separator";
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
function Group({ children }: { children: ReactNode }) { return <div className="flex shrink-0 items-center gap-0.5">{children}</div>; }
function Divider() { return <Separator orientation="vertical" className="mx-1 h-6 self-center" />; }
export function EditorToolbar({ actions, onImage, imageDisabled, onLink }: { actions?: ReactNode; onImage?(): void; imageDisabled?: boolean; onLink(): void }) {
  const { editor, labels, disabled } = useToolbar();
  return <div role="group" aria-label={labels.formatting} data-testid="editor-toolbar" className="sticky top-0 z-10 min-w-0 border-b bg-background" onMouseDown={event => { if ((event.target as HTMLElement).closest('button:not([aria-haspopup])')) event.preventDefault(); }}>
    <ScrollArea type="auto" className="w-full min-w-0 overflow-hidden" onFocusCapture={event => { if (event.currentTarget.contains(event.target)) (event.target as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" }); }}><div className="flex w-max min-w-full items-center py-1">
    <Group><UndoToolbar /><RedoToolbar /></Group><Divider />
    <Group><HeadingsToolbar /><BlockquoteToolbar /><CodeToolbar /><CodeBlockToolbar /></Group><Divider />
    <Group><BoldToolbar /><ItalicToolbar /><UnderlineToolbar /><StrikeThroughToolbar /><Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || !editor.can().setLink({ href: "https://example.com" })} aria-label={labels.link} title={labels.link} onClick={onLink}><Link /></Button></Group><Divider />
    <Group><BulletListToolbar /><OrderedListToolbar /><Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || !editor.can().setHorizontalRule()} aria-label={labels.horizontalRule} title={labels.horizontalRule} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></Button></Group><Divider />
    <AlignmentToolbar /><Divider />
    <Group>{onImage && <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || imageDisabled} aria-label={labels.image} title={labels.image} onClick={onImage}><ImagePlus /></Button>}<ColorHighlightToolbar /></Group><Divider />
    <SearchAndReplaceToolbar /><div className="ml-auto flex items-center gap-1">{actions}</div>
    </div><ScrollBar orientation="horizontal" /></ScrollArea>
  </div>;
}
