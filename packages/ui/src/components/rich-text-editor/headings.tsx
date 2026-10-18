// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.
import { Heading1, Heading2, Heading3 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@tabdo/ui/components/toggle-group";
import { useToolbar } from "./toolbar-provider";
export function HeadingsToolbar() {
  const { editor, labels, disabled } = useToolbar();
  const activeLevel = ([1, 2, 3] as const).find(level => editor.isActive("heading", { level }));
  return <ToggleGroup type="single" size="sm" disabled={disabled} value={String(activeLevel ?? "")} onValueChange={value => { const level = Number(value || activeLevel) as 1 | 2 | 3; editor.chain().focus().toggleHeading({ level }).run(); }}>
    {[Heading1, Heading2, Heading3].map((Icon, index) => <ToggleGroupItem key={index} value={String(index + 1)} aria-label={labels.heading(index + 1)}><Icon /></ToggleGroupItem>)}
  </ToggleGroup>;
}
