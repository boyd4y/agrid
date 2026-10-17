import { z } from "zod";

export const DOCUMENT_LIMITS = { bytes: 64 * 1024, nodes: 4000, depth: 12, images: 20, imageBytes: 5 * 1024 * 1024, attachmentBytes: 50 * 1024 * 1024, attachments: 40 } as const;
export type DocumentMark = { type: "bold" | "italic" | "strike" | "code" } | { type: "link"; attrs: { href: string } };
export type DocumentNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: DocumentMark[]; content?: DocumentNode[] };
export type DocumentContent = { type: "doc"; content: DocumentNode[] };
export const EMPTY_DOCUMENT: DocumentContent = { type: "doc", content: [{ type: "paragraph" }] };
export function safeDocumentLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  try { const url = new URL(value); return ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(key => allowed.includes(key));
/** Iterative validation bounds work before recursive editor/render code can touch untrusted JSON. */
export function documentContentProblem(value: unknown): string | null {
  const pending = [{ value, parent: "root", depth: 0 }], seen = new Set<object>();
  let count = 0, bytes = 0, images = 0;
  while (pending.length) {
    const { value: node, parent, depth } = pending.pop()!;
    if (++count > DOCUMENT_LIMITS.nodes || depth > DOCUMENT_LIMITS.depth) return "Document exceeds node or nesting limit";
    if (!object(node) || seen.has(node) || !keys(node, ["type", "attrs", "text", "marks", "content"])) return "Invalid or unknown node properties";
    seen.add(node);
    if (typeof node.type !== "string") return "Node type is required";
    const type = node.type;
    const inline = ["text", "hardBreak"];
    const blocks = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "image", "horizontalRule"];
    const allowed = parent === "root" ? ["doc"] : ["paragraph", "heading"].includes(parent) ? inline : parent === "codeBlock" ? ["text"] : ["bulletList", "orderedList"].includes(parent) ? ["listItem"] : parent === "listItem" ? ["paragraph", "bulletList", "orderedList", "blockquote", "codeBlock"] : blocks;
    if (!allowed.includes(type)) return `Unsupported ${type} node in ${parent}`;
    if (type === "text") {
      if (typeof node.text !== "string" || !node.text.length || node.attrs !== undefined || node.content !== undefined) return "Invalid text node";
      bytes += new TextEncoder().encode(node.text).length;
    } else if (node.text !== undefined) return "Only text nodes accept text";
    const attrs = node.attrs;
    if (attrs !== undefined && !object(attrs)) return "Invalid attributes";
    const a = (attrs ?? {}) as Record<string, unknown>;
    if (type === "heading") { if (!keys(a, ["level"]) || ![1, 2, 3].includes(a.level as number)) return "Heading level must be 1–3"; }
    else if (type === "orderedList") { if (!keys(a, ["start", "type"]) || a.start !== undefined && (!Number.isInteger(a.start) || Number(a.start) < 1 || Number(a.start) > 1000000) || a.type != null) return "Invalid ordered list attributes"; }
    else if (type === "codeBlock") { if (!keys(a, ["language"]) || a.language != null && (typeof a.language !== "string" || !/^[\w+-]{1,40}$/.test(a.language))) return "Invalid code language"; }
    else if (type === "image") {
      if (++images > DOCUMENT_LIMITS.images || !keys(a, ["fileId", "alt"]) || !z.uuid().safeParse(a.fileId).success || typeof a.alt !== "string" || a.alt.length > 500) return "Images require a private document fileId and alt text";
      bytes += new TextEncoder().encode(a.alt).length;
    } else if (Object.keys(a).length) return "Unknown node attributes";
    if (node.marks !== undefined) {
      if (type !== "text" || parent === "codeBlock" || !Array.isArray(node.marks) || node.marks.length > 5) return "Invalid text marks";
      const types = new Set<string>();
      for (const mark of node.marks) {
        if (!object(mark) || !keys(mark, ["type", "attrs"]) || typeof mark.type !== "string" || types.has(mark.type)) return "Unknown or duplicate mark";
        types.add(mark.type);
        if (mark.type === "code" && node.marks.length !== 1) return "Inline code cannot combine with other marks";
        if (mark.type === "link") {
          if (!object(mark.attrs) || !keys(mark.attrs, ["href"]) || !safeDocumentLink(mark.attrs.href)) return "Unsafe link";
          bytes += new TextEncoder().encode(mark.attrs.href).length;
        } else if (!["bold", "italic", "strike", "code"].includes(mark.type) || mark.attrs !== undefined) return "Unsupported mark";
      }
    }
    if (bytes > DOCUMENT_LIMITS.bytes) return "Document exceeds content budget";
    if (["text", "image", "hardBreak", "horizontalRule"].includes(type)) { if (node.content !== undefined) return "Leaf node cannot contain children"; }
    else {
      const children = node.content ?? [];
      if (!Array.isArray(children) || children.length > DOCUMENT_LIMITS.nodes) return "Invalid child nodes";
      if (["doc", "listItem", "bulletList", "orderedList", "blockquote"].includes(type) && !children.length) return "Block requires children";
      if (type === "listItem" && (!object(children[0]) || children[0].type !== "paragraph")) return "List item must start with a paragraph";
      for (const child of children) pending.push({ value: child, parent: type, depth: depth + 1 });
    }
  }
  // Bounded depth/node/text has already been checked, including unknown properties.
  if (new TextEncoder().encode(JSON.stringify(value)).length > DOCUMENT_LIMITS.bytes) return "Document exceeds JSON byte budget";
  return null;
}
export const documentContentSchema = z.strictObject({ type: z.literal("doc"), content: z.array(z.record(z.string(), z.unknown())).min(1).max(DOCUMENT_LIMITS.nodes) })
  .superRefine((value, ctx) => { const message = documentContentProblem(value); if (message) ctx.addIssue({ code: "custom", message }); });
const scope = { tableId: z.uuid(), rowId: z.uuid() };
const write = { idempotencyKey: z.string().min(1).max(200) };
const version = z.number().int().positive();
export const DOCUMENT_SCHEMAS = {
  getDocument: z.strictObject(scope),
  createDocument: z.strictObject({ ...scope, ...write, content: documentContentSchema }),
  replaceDocument: z.strictObject({ ...scope, ...write, expectedVersion: version, content: documentContentSchema }),
  listDocumentRevisions: z.strictObject({ ...scope, beforeVersion: version.optional(), limit: z.number().int().min(1).max(50).default(20) }),
  getDocumentRevision: z.strictObject({ ...scope, version }),
  restoreDocumentRevision: z.strictObject({ ...scope, ...write, expectedVersion: version, version }),
  renderDocument: z.strictObject({ ...scope, version: version.optional() }),
  uploadDocumentImage: z.strictObject({ ...scope, ...write, expectedVersion: version, name: z.string().min(1).max(255), mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), base64: z.string().min(4).max(Math.ceil(DOCUMENT_LIMITS.imageBytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }),
  getDocumentImage: z.strictObject({ ...scope, fileId: z.uuid() }),
} as const;
export const DOCUMENT_COMMANDS = ["getDocument", "createDocument", "replaceDocument", "listDocumentRevisions", "getDocumentRevision", "restoreDocumentRevision", "renderDocument", "uploadDocumentImage", "getDocumentImage"] as const;
export type DocumentCommand = typeof DOCUMENT_COMMANDS[number];
export const DOCUMENT_READ_COMMANDS: readonly DocumentCommand[] = ["getDocument", "listDocumentRevisions", "getDocumentRevision", "renderDocument", "getDocumentImage"];
export type DocumentCommands = { [K in DocumentCommand]: z.input<typeof DOCUMENT_SCHEMAS[K]> };
export const documentPermissionSchema = z.strictObject({ tableId: z.uuid(), canRead: z.boolean(), canCreate: z.boolean(), canUpdate: z.boolean(), canReadHistory: z.boolean(), canRestore: z.boolean(), canUpload: z.boolean() }).refine(v => v.canRead || v.canCreate || v.canUpdate || v.canReadHistory || v.canRestore || v.canUpload);
export type DocumentPermission = z.infer<typeof documentPermissionSchema>;
export type DocumentReceipt = { id: string; version: number; schemaVersion: 1; tableId: string; rowId: string };
export type RecordDocument = DocumentReceipt & { content: DocumentContent; updatedAt: string };
export type DocumentImage = { fileId: string; name: string; mimeType: string; size: number };
export type DocumentResults = {
  getDocument: RecordDocument | null;
  createDocument: DocumentReceipt;
  replaceDocument: DocumentReceipt;
  listDocumentRevisions: { items: { version: number; createdAt: string; restoredFrom: number | null }[]; hasMore: boolean; nextBeforeVersion: number | null };
  getDocumentRevision: RecordDocument;
  restoreDocumentRevision: DocumentReceipt;
  renderDocument: { html: string; assets: DocumentImage[]; version: number; schemaVersion: 1 };
  uploadDocumentImage: DocumentImage;
  getDocumentImage: DocumentImage & { base64: string };
};
export const DOCUMENT_TOOLS = {
  get_document: { command: "getDocument", description: "按tableId和rowId按需读取独立正文（不存在为null），不通过query_rows读取全文。" },
  create_document: { command: "createDocument", description: "为记录创建唯一正文；schemaVersion=1，受限Tiptap JSON。最多64KiB/4000节点/12层/20图片。带幂等key，仅返回版本回执，不隐含读取权限。" },
  replace_document: { command: "replaceDocument", description: "以expectedVersion整篇替换正文；409时保留草稿并重新读取，绝不覆盖。未知节点/属性及危险链接拒绝。" },
  list_document_revisions: { command: "listDocumentRevisions", description: "分页列出正文历史元数据，最多50条；需独立历史读取授权。" },
  get_document_revision: { command: "getDocumentRevision", description: "读取指定不可变正文历史版本，需历史读取权。" },
  restore_document_revision: { command: "restoreDocumentRevision", description: "恢复历史正文为新版本；需CAS/幂等key及恢复和历史读取授权，原历史不变。" },
  render_document: { command: "renderDocument", description: "读取安全静态HTML与私有图片清单；历史版本另需历史读取权。相对document-assets路径需获权读取图片后解析，不能公开私有下载凭证。" },
  upload_document_image: { command: "uploadDocumentImage", description: "上传正文专属PNG/JPEG/WebP/GIF，base64不含data前缀；单图5MiB、每正文累计40文件/50MiB。需正文版本、幂等key和上传权。返回稳定fileId，无登录token。" },
  get_document_image: { command: "getDocumentImage", description: "按当前正文归属读取私有图片base64，不开放全局文件目录。需正文读取权。" },
} as const satisfies Record<string, { command: DocumentCommand; description: string }>;
