import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asSchema } from "ai";
import { eq } from "drizzle-orm";
import { test } from "../runtime.js";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, workspaces } = await import("../../src/db/schema.js");
const { commandDependencies } = await import("../../src/services/dependencies.js");
const { createTableTools } = await import("../../src/business/agent/tools/index.js");
const reports = await import("../../src/business/reports/service.js");
const sites = await import("../../src/business/sites/service.js");

test("open_preview uses existing scoped reads for report/site and rejects invalid inputs before emitting an event", async () => {
  const org = randomUUID(), foreignOrg = randomUUID();
  try {
    await db.insert(organization).values([org, foreignOrg].map(id => ({ id, name: "Preview fixture", slug: id })));
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await db.insert(workspaces).values(ids.map((id, index) => ({ id, name: `Scope ${index}`, organizationId: index === 2 ? foreignOrg : org })));
    const deps = ids.map(workspaceId => ({ ...commandDependencies(), workspaceId }));
    const own = await reports.saveReport(deps[0], { name: "Visible", description: "", columns: 2, widgets: [] }, org);
    const foreign = await reports.saveReport(deps[1], { name: "Other workspace", description: "", columns: 2, widgets: [] }, org);
    const foreignTenant = await reports.saveReport(deps[2], { name: "Other org", description: "", columns: 2, widgets: [] }, foreignOrg);
    const site = await sites.saveSite(deps[0], { name: "HTML", files: [{ path: "index.html", content: "<!doctype html><h1>Preview</h1>" }], organizationId: org });
    const hiddenSite = await sites.saveSite(deps[1], { name: "Hidden HTML", files: [{ path: "index.html", content: "<!doctype html>Private" }], organizationId: org });
    const tool = createTableTools(deps[0], undefined, org).open_preview;
    const schema = asSchema(tool.inputSchema);
    assert(schema.validate);
    assert((await schema.validate({ kind: "report", reportId: own.id })).success);
    for (const input of [{ kind: "wrong" }, { kind: "report" }, { kind: "report", reportId: "invalid" }, { kind: "report", reportId: own.id, siteId: site.id }, { kind: "table", reportId: own.id }, { kind: "report", reportId: own.id, organizationId: foreignOrg }]) {
      assert(!(await schema.validate(input)).success);
      await assert.rejects(tool.execute(input));
    }
    assert.deepEqual(await tool.execute({ kind: "report", reportId: own.id }), { ok: true, open: true, kind: "report", reportId: own.id });
    assert.equal((await tool.execute({ kind: "report", reportId: own.id, open: false })).open, false);
    assert.equal((await tool.execute({ kind: "site", siteId: site.id })).siteId, site.id);
    for (const reportId of [foreign.id, foreignTenant.id, randomUUID()]) await assert.rejects(tool.execute({ kind: "report", reportId }), /报告不存在/);
    await assert.rejects(tool.execute({ kind: "site", siteId: hiddenSite.id }), /Site not found/);
  } finally {
    for (const id of [org, foreignOrg]) await db.delete(organization).where(eq(organization.id, id));
    await client.end();
  }
});
