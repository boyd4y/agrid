import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createViewSchema, updateViewSchema, COMMANDS, PLATFORM_TOOL_IDS } from "../src/index.js";
test("site config is ordinary table view metadata with optional slug and explicit publication", () => {
  const config = { template: "blog", authorName: "Public", description: "", language: "en", mapping: { title: randomUUID() }, articles: [] };
  assert(createViewSchema.safeParse({ tableId: randomUUID(), type: "site", name: "Any table", config, idempotencyKey: "create" }).success);
  assert(!createViewSchema.safeParse({ tableId: randomUUID(), type: "blog", name: "Old", config, idempotencyKey: "create" }).success);
  const update = { viewId: randomUUID(), expectedVersion: 1, idempotencyKey: "save", config };
  assert(updateViewSchema.safeParse(update).success);
  assert(!updateViewSchema.safeParse({ ...update, publication: { action: "publish" } }).success);
  assert(updateViewSchema.safeParse({ ...update, publication: { action: "publish", expectedPublishedRevisionId: null } }).success);
  for (const command of ["createView", "updateView"]) assert((COMMANDS as readonly string[]).includes(command));
  for (const command of ["createBlog", "getBlog", "buildBlog", "publishBlog", "restoreBlogRevision", "authorizeBlogPublication"]) assert(!(COMMANDS as readonly string[]).includes(command));
  for (const tool of ["create_blog", "publish_blog", "build_blog"]) assert(!(PLATFORM_TOOL_IDS as readonly string[]).includes(tool));
});
