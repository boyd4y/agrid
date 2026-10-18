export const PREVIEW_SHORTCUTS = ["table", "site", "report"] as const;

/** Control on both platforms: Command+Shift+3 is the macOS screenshot shortcut. */
export function previewShortcutKind(event: KeyboardEvent, doc: Document = document) {
  if (!event.ctrlKey || !event.shiftKey || event.metaKey || event.altKey || event.repeat || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return null;
  const target = event.target instanceof Element ? event.target : doc.activeElement;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .cm-editor, .tiptap, .ProseMirror')) return null;
  if (doc.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper], [data-slot="popover-content"]')) return null;
  // Shift changes key to !/@/# on common layouts; physical DigitN stays stable.
  const index = ["Digit1", "Digit2", "Digit3"].indexOf(event.code);
  return index < 0 ? null : PREVIEW_SHORTCUTS[index];
}

export function previewShortcutLabel(index: number) {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? `⌃⇧${index + 1}` : `Ctrl+Shift+${index + 1}`;
}
