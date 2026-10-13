import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { parseSkillDocument } from "../../src/skills/document.js";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, member, session, user } = await import("../../src/db/schema.js");
const { auth } = await import("../../src/auth/index.js");
const { skillsRoute } = await import("../../src/routes/skills.js");
const { membersRoute } = await import("../../src/routes/members.js");
const service = await import("../../src/skills/service.js");
const app = new Hono().route("/api/skills", skillsRoute).route("/api/members", membersRoute);
const org = randomUUID(), foreignOrg = randomUUID();
let userId = "", cookie = "", skillId = "";
const document = (name = "sales-review", content = "Query the source, then verify totals.") => `---\nname: ${name}\ndescription: Review sales data.\n---\n# Review\n\n${content}\n`;
const req = (path = "", method = "GET", body?: unknown, credentials = cookie) => app.request(`http://localhost/api/skills${path}`, {
  method, headers: { Cookie: credentials, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
before(async () => {
  const response = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ email: `skills-${randomUUID()}@local.test`, password: "Test-skills-password-123!", name: "Skill Test" }) }));
  assert.equal(response.status, 200); userId = (await response.json()).user.id;
  cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  await db.insert(organization).values([{ id: org, name: "Skills test", slug: org }, { id: foreignOrg, name: "Foreign skills", slug: foreignOrg }]);
  await db.insert(member).values({ id: randomUUID(), userId, organizationId: org, role: "owner" });
  await db.update(session).set({ activeOrganizationId: org }).where(eq(session.userId, userId));
});
after(async () => { await db.delete(organization).where(eq(organization.id, org)); await db.delete(organization).where(eq(organization.id, foreignOrg)); if (userId) await db.delete(user).where(eq(user.id, userId)); await client.end(); });

test("SKILL.md parses standard frontmatter and refuses malformed, duplicate or aliased metadata", () => {
  assert.equal(parseSkillDocument(document()).name, "sales-review");
  assert.throws(() => parseSkillDocument("No frontmatter"), /frontmatter/);
  assert.throws(() => parseSkillDocument(document("../outside")), /名称/);
  assert.throws(() => parseSkillDocument(document().replace("description:", "name: duplicate\ndescription:")), /frontmatter/);
  assert.throws(() => parseSkillDocument("---\nname: &x sales-review\ndescription: *x\n---\nBody"), /frontmatter/);
  assert.throws(() => parseSkillDocument(document("sales-review", " ").replace("# Review", "")), /正文/);
});

test("builtins are actual read-only documents with workspace-specific persisted enabled state", async () => {
  assert.equal((await req("", "GET", undefined, "")).status, 401);
  const library = await (await req()).json(); assert.equal(library.canManage, true); assert.equal(library.skills.length, 4);
  const builtin = library.skills.find((skill: any) => skill.name === "table");
  assert.equal(builtin.document, undefined); assert.equal(builtin.builtin, true);
  const detail = await (await req(`/${encodeURIComponent(builtin.id)}`)).json(); assert.ok(detail.files.some((file: any) => file.path === "references/relations.md"));
  assert.equal((await req(`/${encodeURIComponent(builtin.id)}`, "PATCH", { document: document(), expectedVersion: 1 })).status, 400);
  assert.equal((await req(`/${encodeURIComponent(builtin.id)}`, "DELETE")).status, 400);
  assert.equal((await req(`/${encodeURIComponent(builtin.id)}/enabled`, "PUT", { enabled: false })).status, 200);
  assert.equal((await service.listSkills(org)).find((skill) => skill.id === builtin.id)?.enabled, false);
  assert.equal((await service.listSkills(foreignOrg)).find((skill) => skill.id === builtin.id)?.enabled, true);
  const runtimeSkills = await service.loadHarnessSkills(org); assert.equal(runtimeSkills.length, 3); assert.ok(runtimeSkills.every((skill) => skill.content.length > 20 && !skill.name.includes("builtin:")));
});

test("custom documents persist; edits use version checks and reject namespace conflicts", async () => {
  assert.equal((await req("", "POST", { document: document() })).status, 405);
  const created = await service.createSkill(org, document(), [{ path: "references/notes.md", content: "Source references" }, { path: "scripts/check.py", content: "print(1)" }]); skillId = created.id; assert.equal(created.version, 1);
  await assert.rejects(service.createSkill(org, document()), /同名/);
  await assert.rejects(service.createSkill(org, document("table")), /内置/);
  const update = await req(`/${skillId}`, "PATCH", { document: document("sales-review", "Verify new instructions."), expectedVersion: 1 }); assert.equal(update.status, 200);
  assert.equal((await req(`/${skillId}`, "PATCH", { document: document(), expectedVersion: 1 })).status, 409);
  const loaded = (await service.listSkills(org)).find((skill) => skill.id === skillId)!; assert.equal(loaded.version, 2); assert.equal(loaded.files.length, 2); assert.match(loaded.content, /new instructions/);
  assert.equal((await service.loadHarnessSkills(org)).find((skill) => skill.name === "sales-review")?.content, loaded.content);
});

test("member reads are allowed, management is admin-only, and foreign UUIDs never cross workspaces", async () => {
  const foreign = await service.createSkill(foreignOrg, document("foreign-secret"));
  assert.equal((await req(`/${foreign.id}`, "PATCH", { document: document(), expectedVersion: 1 })).status, 404);
  assert.equal((await req(`/${foreign.id}/enabled`, "PUT", { enabled: false })).status, 404);
  assert.equal((await req(`/${foreign.id}`, "DELETE")).status, 404);
  assert.ok(!(await service.loadHarnessSkills(org)).some((skill) => skill.name === "foreign-secret"));
  await db.update(member).set({ role: "member" }).where(eq(member.userId, userId));
  assert.equal((await (await req()).json()).canManage, false);
  assert.equal((await req("", "POST", { document: document("forbidden") })).status, 403);
  assert.equal((await req(`/${skillId}`, "DELETE")).status, 403);
  await db.update(member).set({ role: "owner" }).where(eq(member.userId, userId));
  assert.equal((await req(`/${skillId}`, "DELETE")).status, 200);
  assert.ok(!(await service.loadHarnessSkills(org)).some((skill) => skill.name === "sales-review"));
});

test("agent creation and editing persist persona and assigned skills, with runtime intersection and file access", async () => {
  const request = (path: string, body: unknown, method = "POST") => app.request(`http://localhost/api/members${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const response = await request("/agents", { name: "Workflow agent", persona: { systemPrompt: "First understand the business goal.", defaultHarness: "pi", skillNames: ["table", "report"] } });
  assert.equal(response.status, 201); const agent = (await response.json()).member;
  assert.deepEqual(agent.agent.persona.skillNames, ["table", "report"]);
  const { resolveAgentSkills } = await import("../../src/skills/runtime.js");
  const context = await resolveAgentSkills(org, agent.agent.persona.skillNames);
  assert.deepEqual(context.skills.map((skill) => skill.name), ["report"]); // table is disabled in the workspace
  assert.ok(context.skills[0].files?.some((file) => file.path === "scripts/summarize-csv.py"));
  const read = context.tools.read_skill.execute! as (input: { name: string; path?: string }, options: any) => Promise<any>;
  const options = { toolCallId: "read-skill-test", messages: [] };
  const instructions = await read({ name: "report" }, options); assert.match(instructions.content, /业务问题/);
  assert.match((await read({ name: "report", path: "scripts/summarize-csv.py" }, options)).content, /csv.DictReader/);
  await assert.rejects(read({ name: "table" }, options), /未分配/);
  await assert.rejects(read({ name: "form" }, options), /未分配/);
  await assert.rejects(read({ name: "report", path: "../SKILL.md" }, options), /文件不存在/);
  const updated = await request(`/agents/${agent.id}`, { persona: { systemPrompt: "Collect only necessary information.", skillNames: ["form"] } }, "PATCH");
  assert.equal(updated.status, 200); const saved = (await updated.json()).member;
  assert.equal(saved.agent.persona.systemPrompt, "Collect only necessary information."); assert.deepEqual(saved.agent.persona.skillNames, ["form"]);
  assert.equal((await request(`/agents/${agent.id}`, { persona: { skillNames: ["foreign-secret"] } }, "PATCH")).status, 400);
  assert.equal((await request(`/agents/${agent.id}`, { persona: { skillNames: ["form", "form"] } }, "PATCH")).status, 400);
  assert.equal((await request(`/agents/${agent.id}`, { persona: { defaultHarness: "codex" } }, "PATCH")).status, 400);
  assert.deepEqual((await resolveAgentSkills(org, [])).skills, []);
  await db.delete(user).where(eq(user.id, agent.userId));
});

test("skill bundle paths and sizes are validated and cannot shadow files with directories", async () => {
  const { validateSkillFiles } = await import("../../src/skills/document.js");
  for (const path of ["/etc/passwd", "../secret", "scripts/../secret", "C:/file", "scripts\\file", "SKILL.md"]) assert.throws(() => validateSkillFiles([{ path, content: "" }]));
  assert.throws(() => validateSkillFiles([{ path: "references", content: "" }, { path: "references/test.md", content: "" }]), /目录/);
  assert.throws(() => validateSkillFiles([{ path: "same.md", content: "" }, { path: "same.md", content: "" }]), /重复/);
  assert.throws(() => validateSkillFiles([{ path: "large.txt", content: "x".repeat(128001) }]), /超过/);
});
