import assert from "node:assert/strict";
import { test } from "node:test";
import { documentContentSchema, EMPTY_DOCUMENT, DOCUMENT_LIMITS, safeDocumentLink, DOCUMENT_COMMANDS, DOCUMENT_SCHEMAS, DISABLED_TOOLS_SCHEMA, COMMANDS, PLATFORM_TOOL_IDS } from "../src/index.js";
const body = (node: unknown) => ({ type: "doc", content: [node] });
test("document grammar rejects unknown nodes/attributes, dangerous URLs, invalid parents and bounded adversarial JSON", () => {
  assert(documentContentSchema.safeParse(EMPTY_DOCUMENT).success);
  for (const node of [
    { type: "paragraph", content: [{ type: "text", text: "code", marks: [{ type: "code" }, { type: "bold" }] }] },
    { type: "script", text: "alert(1)" }, { type: "paragraph", attrs: { onclick: "alert(1)" } }, { type: "listItem", content: [{ type: "paragraph" }] },
    { type: "paragraph", content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
    { type: "image", attrs: { fileId: "data:image/png;base64,AA", alt: "x" } }, { type: "paragraph", content: [{ type: "text", text: "a".repeat(DOCUMENT_LIMITS.bytes) }] },
    { type: "paragraph", content: Array.from({ length: DOCUMENT_LIMITS.nodes }, () => ({ type: "text", text: "x" })) },
  ]) assert.equal(documentContentSchema.safeParse(body(node)).success, false);
  let nested: any = { type: "paragraph" }; for (let i = 0; i < 30; i++) nested = { type: "blockquote", content: [nested] };
  assert.equal(documentContentSchema.safeParse(body(nested)).success, false);
  const cycle: any = { type: "blockquote", content: [] }; cycle.content.push(cycle); assert.equal(documentContentSchema.safeParse(body(cycle)).success, false);
  for (const url of ["javascript:alert(1)", "data:text/html,bad", "//evil.test", "https://user:secret@example.com", "https://safe.test/\n"]) assert(!safeDocumentLink(url));
  assert(safeDocumentLink("https://example.com/a?x=1&y=2"));
  for (const command of DOCUMENT_COMMANDS) assert(!(COMMANDS as readonly string[]).includes(command));
  for (const tool of ["get_document", "create_document", "replace_document", "render_document", "upload_document_image", "get_document_image"]) assert(!(PLATFORM_TOOL_IDS as readonly string[]).includes(tool));
});

test("formatting grammar preserves underline, alignment and safe hex ink/highlights while rejecting style injection", () => {
  const formatted = (marks: unknown[], attrs: unknown = { textAlign: "center" }) => body({ type: "paragraph", attrs, content: [{ type: "text", text: "格式", marks }] });
  assert(documentContentSchema.safeParse(formatted([{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }, { type: "textStyle", attrs: { color: "#337eA9" } }, { type: "highlight", attrs: { color: "#fdecc8" } }, { type: "link", attrs: { href: "https://example.com" } }])).success);
  for (const textAlign of [null, "left", "center", "right", "justify"]) assert(documentContentSchema.safeParse(formatted([], { textAlign })).success);
  for (const type of ["textStyle", "highlight"]) {
    assert.equal(documentContentSchema.safeParse(formatted([{ type, attrs: { color: null } }])).success, type === "highlight");
    for (const color of ["red", "#fff", "#12345678", "var(--x)", "url(https://evil.test)", "#123456;color:red", "rgb(1,2,3)", { color: "#123456" }, "#123456\n"]) assert(!documentContentSchema.safeParse(formatted([{ type, attrs: { color } }])).success, `${type}: ${JSON.stringify(color)}`);
    assert(!documentContentSchema.safeParse(formatted([{ type, attrs: { color: "#123456", style: "background:url(x)" } }])).success);
  }
  for (const textAlign of ["start", "center;position:fixed", "CENTER", {}, 1]) assert(!documentContentSchema.safeParse(formatted([], { textAlign })).success);
  assert(!documentContentSchema.safeParse(formatted([{ type: "underline", attrs: {} }])).success);
});
