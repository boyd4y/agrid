// Shared commands extracted from floating-menu (tiptap-shadcn @ 84e08b1, MIT).
// See third-party/tiptap-shadcn.LICENSE.
import type { Editor } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, AlignJustify, Code2, CodeSquare, Heading1, Heading2, Heading3, Image as ImageIcon, List, ListOrdered, Minus, Quote, Text, type LucideIcon } from "lucide-react";
import type { RichTextLabels } from "../rich-text-editor";
export type BlockCommand = { key: string; title: string; icon: LucideIcon; keywords: string; group: "basicBlocks" | "inline" | "alignment"; command(editor: Editor): void };
export function blockCommands(labels: RichTextLabels, onImage?: () => void, imageDisabled?: boolean): BlockCommand[] {
  return [
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
  ];
}
