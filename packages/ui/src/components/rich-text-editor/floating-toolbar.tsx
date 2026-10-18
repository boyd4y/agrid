// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.
import { type RefObject } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import { BoldToolbar } from "./bold";
import { ItalicToolbar } from "./italic";
import { useToolbar } from "./toolbar-provider";
import { Button } from "@tabdo/ui/components/button";
import { Link } from "lucide-react";
export function FloatingToolbar({ root, onLink, suppress }: { root: RefObject<HTMLDivElement | null>; onLink(): void; suppress: boolean }) {
  const { editor, labels, disabled } = useToolbar();
  return <BubbleMenu editor={editor} appendTo={() => root.current!} updateDelay={100} options={{ placement: "top", offset: 8, shift: { padding: 8 }, flip: true }} shouldShow={({ editor, from, to }) => !disabled && !suppress && !editor.view.composing && from !== to && !!editor.state.doc.textBetween(from, to).trim() && (editor.isFocused || !!root.current?.querySelector('[data-testid="selection-formatting"]')?.contains(document.activeElement))} data-testid="selection-formatting" aria-label={labels.selectionFormatting} className="flex items-center gap-1 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md" onMouseDown={event => event.preventDefault()}>
    <BoldToolbar /><ItalicToolbar /><Button type="button" variant="ghost" size="icon" aria-label={labels.link} onClick={onLink}><Link /></Button>
  </BubbleMenu>;
}
