import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { RichTextEditor, useRichTextEditor, type RichTextLabels } from "./rich-text-editor";
const allowed = (href: string) => { try { return ["https:", "http:", "mailto:"].includes(new URL(href).protocol); } catch { return false; } };
const english: RichTextLabels = { insertFormat: "Insert/format", formatting: "Formatting", selectionFormatting: "Format selection", bold: "Bold", italic: "Italic", heading: level => `Heading ${level}`, bulletList: "Bullet list", orderedList: "Numbered list", quote: "Quote", codeBlock: "Code block", link: "Link", image: "Image", undo: "Undo", redo: "Redo", close: "Close", linkHint: "Use a full https://, http:// or mailto: address. Clear to remove.", url: "URL", applyLink: "Apply link", removeLink: "Remove link" };
const chinese: RichTextLabels = { insertFormat: "插入/格式", formatting: "正文排版", selectionFormatting: "选中文字排版", bold: "加粗", italic: "斜体", heading: level => `标题 ${level}`, bulletList: "无序列表", orderedList: "有序列表", quote: "引用", codeBlock: "代码块", link: "链接", image: "图片", undo: "撤销", redo: "重做", close: "关闭", linkHint: "请输入完整 https://、http:// 或 mailto: 地址，清空可移除。", url: "链接地址", applyLink: "应用链接", removeLink: "移除链接" };
function Example({ locale = "en" }: { locale?: "en" | "zh-CN" }) {
  const labels = locale === "en" ? english : chinese;
  const [json, setJson] = useState("");
  const editor = useRichTextEditor({ isAllowedUri: allowed, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: locale === "en" ? "Click to write. Select text for formatting, or open Insert/format." : "点击直接写作。选中文字排版，或打开插入/格式。" }] }] }, editorProps: { attributes: { "aria-label": locale === "en" ? "Body" : "正文", "data-placeholder": locale === "en" ? "Start writing…" : "开始写作…" } }, onUpdate: ({ editor }) => setJson(JSON.stringify(editor.getJSON())) });
  return <div className="mx-auto w-full max-w-[720px] p-4"><RichTextEditor editor={editor} labels={labels} isAllowedUri={allowed} /><output className="block break-all text-xs text-muted-foreground">{json}</output></div>;
}
const meta: Meta<typeof Example> = { title: "UI/RichTextEditor", component: Example };
export default meta;
type Story = StoryObj<typeof meta>;
export const English: Story = { args: { locale: "en" } };
export const Chinese: Story = { args: { locale: "zh-CN" } };
