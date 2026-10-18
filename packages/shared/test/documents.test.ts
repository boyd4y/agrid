import assert from "node:assert/strict";
import { test } from "node:test";
import { documentContentSchema, EMPTY_DOCUMENT, DOCUMENT_LIMITS, safeDocumentLink, DOCUMENT_COMMANDS, DOCUMENT_TOOLS, DOCUMENT_SCHEMAS, documentPermissionSchema, DISABLED_TOOLS_SCHEMA, COMMANDS, PLATFORM_TOOL_IDS } from "../src/index.js";
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
  for (const command of DOCUMENT_COMMANDS) assert((COMMANDS as readonly string[]).includes(command));
  for (const tool of Object.keys(DOCUMENT_TOOLS)) assert((PLATFORM_TOOL_IDS as readonly string[]).includes(tool));
});

test("current body is the only public document capability; old history flags only parse for compatibility", () => {
  for (const command of ["listDocumentRevisions", "getDocumentRevision", "restoreDocumentRevision"]) assert(!(COMMANDS as readonly string[]).includes(command));
  for (const tool of ["list_document_revisions", "get_document_revision", "restore_document_revision"]) assert(!(PLATFORM_TOOL_IDS as readonly string[]).includes(tool));
  assert.deepEqual(DISABLED_TOOLS_SCHEMA.parse(["list_document_revisions", "get_document_revision", "restore_document_revision", "get_document"]), ["get_document"], "old disabled tool settings normalize without restoring removed tools");
  const scope = { tableId: crypto.randomUUID(), rowId: crypto.randomUUID() };
  assert(DOCUMENT_SCHEMAS.renderDocument.safeParse(scope).success);
  assert(!DOCUMENT_SCHEMAS.renderDocument.safeParse({ ...scope, version: 1 }).success);
  const grant = { tableId: scope.tableId, canRead: true, canCreate: false, canUpdate: false, canUpload: false };
  assert.deepEqual(documentPermissionSchema.parse(grant), { ...grant, canReadHistory: false, canRestore: false });
  assert(documentPermissionSchema.safeParse({ ...grant, canReadHistory: true, canRestore: true }).success);
});
