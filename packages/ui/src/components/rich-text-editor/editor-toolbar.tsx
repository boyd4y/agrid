// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.
import { useRef, useState, type ReactNode } from "react";
import { Plus, ImagePlus } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { BoldToolbar } from "./bold";
import { ItalicToolbar } from "./italic";
import { HeadingsToolbar } from "./headings";
import { BlockquoteToolbar } from "./blockquote";
import { CodeBlockToolbar } from "./code-block";
import { BulletListToolbar } from "./bullet-list";
import { OrderedListToolbar } from "./ordered-list";
import { UndoToolbar } from "./undo";
import { RedoToolbar } from "./redo";
import { Link as LinkIcon } from "lucide-react";
import { useToolbar } from "./toolbar-provider";
export function EditorToolbar({ actions, onImage, imageDisabled, onLink }: { actions?: ReactNode; onImage?(): void; imageDisabled?: boolean; onLink(): void }) {
  const { labels, disabled } = useToolbar();
  const [open, setOpen] = useState(false);
  const commandExecuted = useRef(false);
  return <div className="flex min-h-10 items-center justify-end gap-1 py-1">
    <Popover open={open} onOpenChange={next => { if (next) commandExecuted.current = false; setOpen(next); }}><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" disabled={disabled}><Plus />{labels.insertFormat}</Button></PopoverTrigger><PopoverContent aria-label={labels.formatting} className="w-80 p-2" align="end" onCloseAutoFocus={event => { if (commandExecuted.current) event.preventDefault(); }}>
      {/* Capture before a command focuses the editor or opens another dialog. Cancellation uses Radix's trigger focus restoration. */}
      <div className="flex flex-wrap items-center gap-1" onClickCapture={event => { if ((event.target as HTMLElement).closest('button:not([aria-haspopup])')) commandExecuted.current = true; }} onClick={event => { if ((event.target as HTMLElement).closest('button:not([aria-haspopup])')) setOpen(false); }}>
        <BoldToolbar /><ItalicToolbar /><HeadingsToolbar /><BulletListToolbar /><OrderedListToolbar /><BlockquoteToolbar /><CodeBlockToolbar />
        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={labels.link} onClick={onLink}><LinkIcon /></Button>
        {onImage && <Button type="button" variant="ghost" size="icon" disabled={disabled || imageDisabled} aria-label={labels.image} onClick={onImage}><ImagePlus /></Button>}
        <UndoToolbar /><RedoToolbar />
      </div>
    </PopoverContent></Popover>{actions}
  </div>;
}
