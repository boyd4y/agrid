import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { BLOG_COMMANDS, BLOG_TOOLS, BLOG_SCHEMAS, DOCUMENT_SCHEMAS, EMPTY_DOCUMENT, COMMANDS, PLATFORM_TOOL_IDS } from "../src/index.js";

test("direct writing commands are available to every transport and configurable platform tool catalog", () => {
  for (const command of BLOG_COMMANDS) assert((COMMANDS as readonly string[]).includes(command));
  for (const tool of Object.keys(BLOG_TOOLS)) assert((PLATFORM_TOOL_IDS as readonly string[]).includes(tool));
  assert(BLOG_SCHEMAS.createBlog.safeParse({ name: "中文博客", idempotencyKey: "create" }).success);
  const input = { siteId: randomUUID(), expectedVersion: 1, title: "中文文章", idempotencyKey: "write" };
  assert(BLOG_SCHEMAS.startBlogArticle.safeParse(input).success);
  assert(!BLOG_SCHEMAS.startBlogArticle.safeParse({ ...input, rowId: randomUUID() }).success, "existing rows require their independent CAS version");
  const body = { tableId: randomUUID(), rowId: randomUUID(), content: EMPTY_DOCUMENT, idempotencyKey: "body" };
  assert(DOCUMENT_SCHEMAS.replaceDocument.safeParse({ ...body, expectedVersion: 0 }).success);
  assert(!DOCUMENT_SCHEMAS.replaceDocument.safeParse({ ...body, expectedVersion: -1 }).success);

});
