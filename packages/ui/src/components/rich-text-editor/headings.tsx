// Adapted from upstream basic/components/toolbars/headings.tsx @ 84e08b1 (MIT).
import { useToolbar } from "./toolbar-provider";
import { ToolbarMenu, ToolbarMenuItem } from "./toolbar-menu";
export function HeadingsToolbar() {
  const { editor, labels } = useToolbar();
  const activeLevel = ([1, 2, 3] as const).find(level => editor.isActive("heading", { level }));
  return <ToolbarMenu label={activeLevel ? labels.heading(activeLevel) : labels.paragraph} active={!!activeLevel}>{run => <>
    <ToolbarMenuItem onSelect={() => run(() => { editor.chain().focus().setParagraph().run(); })}>{labels.paragraph}</ToolbarMenuItem>
    {([1, 2, 3] as const).map(level => <ToolbarMenuItem key={level} onSelect={() => run(() => { editor.chain().focus().setHeading({ level }).run(); })}>{labels.heading(level)}</ToolbarMenuItem>)}
  </>}</ToolbarMenu>;
}
