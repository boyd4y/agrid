import assert from "node:assert/strict";
import { test } from "node:test";
import { OPEN_PREVIEW_SCHEMA } from "../src/preview.js";
const id = "140d8085-085e-45f2-b909-36a7d562b810";
test("preview accepts existing kinds and report IDs, rejects ambiguous or malformed targets", () => {
  for (const input of [{}, { kind: "table", tableId: id }, { kind: "form", viewId: id }, { kind: "automations", tableId: id }, { kind: "site", siteId: id }, { kind: "report", reportId: id }]) assert(OPEN_PREVIEW_SCHEMA.safeParse(input).success);
  for (const input of [{ kind: "other" }, { kind: "report" }, { kind: "site" }, { kind: "report", reportId: "wrong" }, { kind: "site", siteId: id, reportId: id }, { kind: "report", reportId: id, tableId: id }, { kind: "table", reportId: id }, { organizationId: id }]) assert(!OPEN_PREVIEW_SCHEMA.safeParse(input).success);
});
