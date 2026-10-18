// Adapted from ehtisham-afzal/tiptap-shadcn basic/components/extensions/floating-menu.tsx
// @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT). See third-party/tiptap-shadcn.LICENSE.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { AlignCenter, AlignLeft, AlignRight, AlignJustify, Code2, CodeSquare, Heading1, Heading2, Heading3, Image as ImageIcon, List, ListOrdered, Minus, Quote, Text, type LucideIcon } from "lucide-react";
import { Command, CommandGroup, CommandItem, CommandList } from "@tabdo/ui/components/command";
import { Popover, PopoverAnchor, PopoverContent } from "@tabdo/ui/components/popover";
import { slashTrigger, type SlashTrigger } from "@tabdo/ui/lib/rich-text-slash";
import { useToolbar } from "./toolbar-provider";
type BlockCommand = { key: string; title: string; icon: LucideIcon; keywords: string; group: "basicBlocks" | "inline" | "alignment"; command(editor: Editor): void };
export function FloatingMenu({ onImage, imageDisabled, suppress }: { onImage?(): void; imageDisabled?: boolean; suppress?: boolean }) {
  const { editor, labels, disabled } = useToolbar(), id = useId();
  const [trigger, setTrigger] = useState<SlashTrigger | null>(null), [selected, setSelected] = useState("");
  const dismissed = useRef<string | null>(null), current = useRef<{ trigger: SlashTrigger | null; items: BlockCommand[]; selected: string }>({ trigger: null, items: [], selected: "" });
  const list = useRef<HTMLDivElement>(null);
  const commands = useMemo<BlockCommand[]>(() => [
    { key: "paragraph", title: labels.paragraph, icon: Text, keywords: "paragraph text normal 正文 文本 段落", group: "basicBlocks", command: e => { e.chain().focus().clearNodes().setParagraph().run(); } },
    ...([1, 2, 3] as const).map((level, index) => ({ key: `heading${level}`, title: labels.heading(level), icon: [Heading1, Heading2, Heading3][index], keywords: `h${level} heading ${level} title 标题${level} 标题 ${level}`, group: "basicBlocks" as const, command: (e: Editor) => { e.chain().focus().setHeading({ level }).run(); } })),
    { key: "bulletList", title: labels.bulletList, icon: List, keywords: "bullet list unordered ul 无序 列表", group: "basicBlocks", command: e => { e.chain().focus().toggleBulletList().run(); } },
    { key: "orderedList", title: labels.orderedList, icon: ListOrdered, keywords: "numbered list ordered ol 有序 编号 列表", group: "basicBlocks", command: e => { e.chain().focus().toggleOrderedList().run(); } },
    { key: "codeBlock", title: labels.codeBlock, icon: Code2, keywords: "code block snippet pre 代码块", group: "basicBlocks", command: e => { e.chain().focus().toggleCodeBlock().run(); } },
    ...(onImage && !imageDisabled ? [{ key: "image", title: labels.image, icon: ImageIcon, keywords: "image picture photo 图片 照片", group: "basicBlocks" as const, command: () => onImage() }] : []),
    { key: "horizontalRule", title: labels.horizontalRule, icon: Minus, keywords: "horizontal rule divider 分隔线", group: "basicBlocks", command: e => { e.chain().focus().setHorizontalRule().run(); } },
    { key: "quote", title: labels.quote, icon: Quote, keywords: "quote blockquote cite 引用", group: "inline", command: e => { e.chain().focus().toggleBlockquote().run(); } },
    { key: "code", title: labels.code, icon: CodeSquare, keywords: "code inline 行内代码", group: "inline", command: e => { e.chain().focus().toggleCode().run(); } },
    ...(["left", "center", "right", "justify"] as const).map((align, index) => ({ key: align, title: labels.align(align), icon: [AlignLeft, AlignCenter, AlignRight, AlignJustify][index], keywords: `align ${align} 对齐 ${["左", "中 居中", "右", "两端"][index]}`, group: "alignment" as const, command: (e: Editor) => { e.chain().focus().setTextAlign(align).run(); } })),
  ], [labels, onImage, imageDisabled]);
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
