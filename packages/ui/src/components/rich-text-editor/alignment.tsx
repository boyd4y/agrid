// Adapted from upstream basic/components/toolbars/alignment.tsx @ 84e08b1 (MIT).
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Check } from "lucide-react";
import { useToolbar } from "./toolbar-provider";
import { ToolbarMenu, ToolbarMenuItem } from "./toolbar-menu";
export const alignments = ["left", "center", "right", "justify"] as const;
const icons = [AlignLeft, AlignCenter, AlignRight, AlignJustify];
export function AlignmentToolbar() {
  const { editor, labels } = useToolbar();
  const active = alignments.findIndex(textAlign => editor.isActive({ textAlign })), Icon = icons[Math.max(0, active)];
  return <ToolbarMenu label={labels.alignment} icon={<Icon />} disabled={!editor.can().setTextAlign("left")}>{run => alignments.map((value, index) => { const ItemIcon = icons[index]; return <ToolbarMenuItem key={value} onSelect={() => run(() => { editor.chain().focus().setTextAlign(value).run(); })}><ItemIcon />{labels.align(value)}{index === Math.max(0, active) && <Check className="ml-auto" aria-hidden />}</ToolbarMenuItem>; })}</ToolbarMenu>;
}
