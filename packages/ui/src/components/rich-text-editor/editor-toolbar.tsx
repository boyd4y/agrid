// Adapted from ehtisham-afzal/tiptap-shadcn basic/components/toolbars/editor-toolbar.tsx
// @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT). See third-party/tiptap-shadcn.LICENSE.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ImagePlus, Link, Minus } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { ToolbarMenu, ToolbarMenuItem } from "./toolbar-menu";
import { blockCommands } from "./block-commands";
import { useToolbar } from "./toolbar-provider";
function Group({ children }: { children: ReactNode }) { return <div className="flex max-w-full shrink-0 flex-wrap items-center gap-0.5">{children}</div>; }
function StyleMenu() {
  const { labels, disabled } = useToolbar();
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-8" disabled={disabled}>{labels.styles}<ChevronDown /></Button></PopoverTrigger>
    <PopoverContent aria-label={labels.styles} align="start" className="flex w-64 flex-col gap-1 p-2" onMouseDown={event => { if ((event.target as HTMLElement).closest('button:not([aria-haspopup])')) event.preventDefault(); }}>
      <StrikeThroughToolbar className="h-8 w-full justify-start gap-2 px-2">{labels.strike}</StrikeThroughToolbar>
      <CodeToolbar className="h-8 w-full justify-start gap-2 px-2">{labels.code}</CodeToolbar>
      <AlignmentToolbar /><ColorHighlightToolbar />
    </PopoverContent>
  </Popover>;
}
export function EditorToolbar({ actions, onImage, imageDisabled, onLink }: { actions?: ReactNode; onImage?(): void; imageDisabled?: boolean; onLink(): void }) {
  const { editor, labels, disabled } = useToolbar();
  const root = useRef<HTMLDivElement>(null), previousFull = useRef(false), restoreFocus = useRef(false);
  const [full, setFull] = useState(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width >= 960;
      if (next === previousFull.current) return;
      // Portal focus belongs to an expanded trigger even though its DOM is outside this root.
      restoreFocus.current = element.contains(document.activeElement) || !!element.querySelector('[aria-expanded="true"]');
      previousFull.current = next; setFull(next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    editor.commands.setSearchTerm("");
    const frame = requestAnimationFrame(() => editor.commands.focus(undefined, { scrollIntoView: false }));
    return () => cancelAnimationFrame(frame);
  }, [full, editor]);
  const link = <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || !editor.can().setLink({ href: "https://example.com" })} aria-label={labels.link} title={labels.link} onClick={onLink}><Link /></Button>;
  const commands = blockCommands(labels, onImage, imageDisabled);
  const commandMenu = (label: string, keys: string[]) => <ToolbarMenu label={label}>{run => commands.filter(item => keys.includes(item.key)).map(item => <ToolbarMenuItem key={item.key} onSelect={() => run(() => item.command(editor))}><item.icon />{item.title}</ToolbarMenuItem>)}</ToolbarMenu>;
  return <div ref={root} role="group" aria-label={labels.formatting} data-testid="editor-toolbar" className="sticky top-0 z-10 min-w-0 border-b bg-background" onMouseDown={event => { if ((event.target as HTMLElement).closest('button:not([aria-haspopup])')) event.preventDefault(); }}>
    {full ? <div key="full" data-toolbar-layout="full" className="flex items-center gap-3 py-1">
      <Group><UndoToolbar /><RedoToolbar /></Group>
      <Group><HeadingsToolbar /><BlockquoteToolbar /><CodeToolbar /><CodeBlockToolbar /></Group>
      <Group><BoldToolbar /><ItalicToolbar /><UnderlineToolbar /><StrikeThroughToolbar />{link}</Group>
      <Group><BulletListToolbar /><OrderedListToolbar /><Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || !editor.can().setHorizontalRule()} aria-label={labels.horizontalRule} title={labels.horizontalRule} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></Button></Group>
      <Group><AlignmentToolbar />{onImage && <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled || imageDisabled} aria-label={labels.image} title={labels.image} onClick={onImage}><ImagePlus /></Button>}<ColorHighlightToolbar /></Group>
      <Group><SearchAndReplaceToolbar />{actions}</Group>
    </div> : <div key="grouped" data-toolbar-layout="grouped" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
      <Group><BoldToolbar /><ItalicToolbar /><UnderlineToolbar />{link}</Group>
      {commandMenu(labels.structure, ["paragraph", "heading1", "heading2", "heading3", "bulletList", "orderedList", "quote", "codeBlock"])}
      {commandMenu(labels.insert, ["image", "horizontalRule"])}
      <StyleMenu />
      <Group><UndoToolbar /><RedoToolbar /><SearchAndReplaceToolbar />{actions}</Group>
    </div>}
  </div>;
}
