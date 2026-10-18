// Trigger boundary adapted from upstream extensions/floating-menu.tsx @ 84e08b1 (MIT).
import type { EditorState } from "@tiptap/pm/state";
export type SlashTrigger = { from: number; to: number; query: string };
export function slashTrigger(state: EditorState): SlashTrigger | null {
  const { $from, empty } = state.selection;
  if (!empty || !["paragraph", "heading"].includes($from.parent.type.name)) return null;
  const prefix = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
  // Only a slash at the start of a textblock triggers commands; paths/URLs stay literal.
  if (!/^\/[^/\n\ufffc]{0,64}$/.test(prefix)) return null;
  return { from: $from.start(), to: $from.pos, query: prefix.slice(1).trim().toLowerCase() };
}
