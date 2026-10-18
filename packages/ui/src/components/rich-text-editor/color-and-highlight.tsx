// Adapted from upstream basic/components/toolbars/color-and-highlight.tsx @ 84e08b1 (MIT).
import { Check, Paintbrush } from "lucide-react";
import { DropdownMenuLabel, DropdownMenuSeparator } from "@tabdo/ui/components/dropdown-menu";
import { useToolbar } from "./toolbar-provider";
import { ToolbarMenu, ToolbarMenuItem } from "./toolbar-menu";
// Document ink, not UI chrome. Fixed serializable hex replaces upstream CSS variable strings.
export const documentPalette = [
  { name: "gray", ink: "#787774", highlight: "#e9e9e7" },
  { name: "brown", ink: "#9f6b53", highlight: "#eee0da" },
  { name: "orange", ink: "#d9730d", highlight: "#fadec9" },
  { name: "yellow", ink: "#b88700", highlight: "#fdecc8" },
  { name: "green", ink: "#448361", highlight: "#dbeddb" },
  { name: "blue", ink: "#337ea9", highlight: "#d3e5ef" },
  { name: "purple", ink: "#9065b0", highlight: "#e8deee" },
  { name: "pink", ink: "#c14c8a", highlight: "#f5e0e9" },
  { name: "red", ink: "#d44c47", highlight: "#ffe2dd" },
] as const;
export function ColorHighlightToolbar() {
  const { editor, labels } = useToolbar();
  return <ToolbarMenu label={labels.colorHighlight} icon={<Paintbrush />} disabled={editor.isActive("code") || editor.isActive("codeBlock")}>{run => <>
    <DropdownMenuLabel>{labels.color}</DropdownMenuLabel>
    <ToolbarMenuItem onSelect={() => run(() => { editor.chain().focus().unsetColor().run(); })}>{labels.defaultColor}</ToolbarMenuItem>
    {documentPalette.map(({ name, ink }) => <ToolbarMenuItem key={name} onSelect={() => run(() => { editor.chain().focus().setColor(ink).run(); })}><span aria-hidden style={{ color: ink }}>A</span>{labels.colorName(name)}{editor.getAttributes("textStyle").color === ink && <Check className="ml-auto" aria-hidden />}</ToolbarMenuItem>)}
    <DropdownMenuSeparator /><DropdownMenuLabel>{labels.highlight}</DropdownMenuLabel>
    <ToolbarMenuItem onSelect={() => run(() => { editor.chain().focus().unsetHighlight().run(); })}>{labels.defaultColor}</ToolbarMenuItem>
    {documentPalette.map(({ name, highlight }) => <ToolbarMenuItem key={name} onSelect={() => run(() => { editor.chain().focus().setHighlight({ color: highlight }).run(); })}><span aria-hidden className="size-4 rounded-sm border" style={{ backgroundColor: highlight }} />{labels.colorName(name)}{editor.getAttributes("highlight").color === highlight && <Check className="ml-auto" aria-hidden />}</ToolbarMenuItem>)}
  </>}</ToolbarMenu>;
}
