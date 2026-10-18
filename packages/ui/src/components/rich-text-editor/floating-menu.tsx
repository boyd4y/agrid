// Adapted from ehtisham-afzal/tiptap-shadcn basic/components/extensions/floating-menu.tsx
// @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT). See third-party/tiptap-shadcn.LICENSE.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Command, CommandGroup, CommandItem, CommandList } from "@tabdo/ui/components/command";
import { Popover, PopoverAnchor, PopoverContent } from "@tabdo/ui/components/popover";
import { slashTrigger, type SlashTrigger } from "@tabdo/ui/lib/rich-text-slash";
import { blockCommands, type BlockCommand } from "./block-commands";
import { useToolbar } from "./toolbar-provider";
export function FloatingMenu({ onImage, imageDisabled, suppress }: { onImage?(): void; imageDisabled?: boolean; suppress?: boolean }) {
  const { editor, labels, disabled } = useToolbar(), id = useId();
  const [trigger, setTrigger] = useState<SlashTrigger | null>(null), [selected, setSelected] = useState("");
  const dismissed = useRef<string | null>(null), current = useRef<{ trigger: SlashTrigger | null; items: BlockCommand[]; selected: string }>({ trigger: null, items: [], selected: "" });
  const list = useRef<HTMLDivElement>(null);
  const commands = useMemo(() => blockCommands(labels, onImage, imageDisabled), [labels, onImage, imageDisabled]);
  const items = commands.filter(item => `${item.title} ${item.keywords} ${labels.commandDescription(item.key)}`.toLowerCase().includes(trigger?.query ?? ""));
  const active = items.some(item => item.key === selected) ? selected : items[0]?.key ?? "";
  current.current = { trigger, items, selected: active };
  const close = () => { const t = current.current.trigger; if (t) dismissed.current = `${t.from}:${t.to}:${t.query}`; setTrigger(null); };
  const execute = (item: BlockCommand) => {
    const t = current.current.trigger, now = slashTrigger(editor.state);
    if (!t || !now || now.from !== t.from || now.to !== t.to || now.query !== t.query || editor.view.composing || disabled) return;
    setTrigger(null);
    // Delete precisely the triggering prefix, retaining text after the cursor.
    editor.chain().focus().deleteRange({ from: t.from, to: t.to }).run();
    item.command(editor);
  };
  const handlers = useRef({ close, execute }); handlers.current = { close, execute };
  useEffect(() => {
    const refresh = () => {
      const next = !disabled && !suppress && editor.isEditable && editor.isFocused && !editor.view.composing ? slashTrigger(editor.state) : null;
      const signature = next ? `${next.from}:${next.to}:${next.query}` : null;
      if (!next) dismissed.current = null;
      const visible = signature && signature !== dismissed.current ? next : null;
      setTrigger(previous => previous?.from === visible?.from && previous?.to === visible?.to && previous?.query === visible?.query ? previous : visible);
    };
    const key = new PluginKey("richTextSlash");
    editor.registerPlugin(new Plugin({ key, props: { handleKeyDown(view, event) {
      const state = current.current;
      if (!state.trigger || event.isComposing || view.composing || event.keyCode === 229) return false;
      if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return false;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") handlers.current.close();
      else if (event.key === "Enter") { const item = state.items.find(item => item.key === state.selected); if (item) handlers.current.execute(item); }
      else if (state.items.length) { const index = state.items.findIndex(item => item.key === state.selected); setSelected(state.items[(index + (event.key === "ArrowDown" ? 1 : -1) + state.items.length) % state.items.length].key); }
      return true;
    } } }), (plugin, plugins) => [plugin, ...plugins]);
    let timer: ReturnType<typeof setTimeout>;
    const compositionStart = () => setTrigger(null), compositionEnd = () => { timer = setTimeout(refresh, 0); };
    const dom = editor.view.dom;
    dom.addEventListener("compositionstart", compositionStart); dom.addEventListener("compositionend", compositionEnd);
    editor.on("transaction", refresh); editor.on("focus", refresh); editor.on("blur", refresh);
    refresh();
    return () => { clearTimeout(timer); editor.off("transaction", refresh); editor.off("focus", refresh); editor.off("blur", refresh); dom.removeEventListener("compositionstart", compositionStart); dom.removeEventListener("compositionend", compositionEnd); editor.unregisterPlugin(key); };
  }, [editor, disabled, suppress]);
  useEffect(() => { setSelected(""); }, [trigger?.query]);
  useEffect(() => {
    list.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
    const dom = editor.view.dom;
    if (trigger) { dom.setAttribute("aria-controls", id); dom.setAttribute("aria-expanded", "true"); }
    else { dom.removeAttribute("aria-controls"); dom.removeAttribute("aria-expanded"); }
    return () => { dom.removeAttribute("aria-controls"); dom.removeAttribute("aria-expanded"); };
  }, [active, trigger, editor, id]);
  const anchor = useRef({ contextElement: editor.view.dom, getBoundingClientRect: () => { const t = current.current.trigger; if (!t) return new DOMRect(); const r = editor.view.coordsAtPos(t.to); return new DOMRect(r.left, r.top, 0, r.bottom - r.top); } });
  return <Popover open={!!trigger} onOpenChange={open => { if (!open) close(); }}><PopoverAnchor virtualRef={anchor} /><PopoverContent aria-label={labels.slashCommands} align="start" side="bottom" collisionPadding={8} className="w-72 p-1" onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); close(); }} onInteractOutside={event => { if (editor.view.dom.contains(event.target as Node)) event.preventDefault(); }}>
    <Command shouldFilter={false} value={active} onValueChange={setSelected} label={labels.slashCommands}><CommandList id={id} ref={list} className="max-h-[min(330px,var(--radix-popover-content-available-height))]">
      {!items.length && <div role="status" className="p-3 text-sm text-muted-foreground">{labels.noResults}</div>}
      {(["basicBlocks", "inline", "alignment"] as const).map(group => { const grouped = items.filter(item => item.group === group); return grouped.length > 0 && <CommandGroup key={group} heading={labels[group]}>{grouped.map(item => <CommandItem key={item.key} value={item.key} onMouseDown={event => event.preventDefault()} onSelect={() => execute(item)} className="gap-3 py-2"><span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background"><item.icon /></span><span className="flex min-w-0 flex-1 flex-col"><span>{item.title}</span><span className="text-xs text-muted-foreground">{labels.commandDescription(item.key)}</span></span></CommandItem>)}</CommandGroup>; })}
    </CommandList></Command>
  </PopoverContent></Popover>;
}
