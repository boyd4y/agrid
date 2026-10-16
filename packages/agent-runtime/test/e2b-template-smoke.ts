import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { parseEnv } from "node:util";
import { ApiClient, ConnectionConfig, Template, type BuildInfo } from "e2b";

const value = (flag: string) => process.argv[process.argv.indexOf(flag) + 1];
const envFile = value("--env-file"), stateFile = value("--state");
assert(process.argv.includes("--env-file") && process.argv.includes("--state") && envFile && stateFile);
assert.equal((await stat(envFile)).mode & 0o777, 0o600);
process.env.E2B_API_KEY = parseEnv(await readFile(envFile, "utf8")).E2B_API_KEY;
const apiKey = process.env.E2B_API_KEY;
assert(apiKey && process.env.HARNESS_E2B_SMOKE === "1", "explicit opt-in and E2B credentials required");
const client = new ApiClient(new ConnectionConfig({ apiKey }));
const log = (name: string, details: unknown) => console.log(JSON.stringify({ at: new Date().toISOString(), name, details }));
const safe = (error: unknown) => String(error instanceof Error ? `${error.name}: ${error.message}` : error).replaceAll(apiKey, "[redacted]");

async function remove(build: BuildInfo) {
  assert(/^tabdo-0016-node24-[0-9a-f-]+$/.test(build.name), "only this task's named templates can be removed");
  const { data, response } = await client.api.GET("/templates/{templateID}", { params: { path: { templateID: build.templateId } } });
  assert(response.ok && data, `template ownership read failed (${response.status})`);
  assert([...data.aliases, ...data.names].some(name => name === build.name || name.endsWith(`/${build.name}`)), "template name must match recorded build");
  const deleted = await client.api.DELETE("/templates/{templateID}", { params: { path: { templateID: build.templateId } } });
  assert.equal(deleted.response.status, 204);
  assert.equal(await Template.exists(build.name, { apiKey }), false);
  log("template-deleted", build);
}

if (process.argv.includes("--cleanup")) {
  await remove(JSON.parse(await readFile(stateFile, "utf8")) as BuildInfo);
} else {
  const name = `tabdo-0016-node24-${randomUUID()}`;
  assert.equal(await Template.exists(name, { apiKey }), false);
  const template = Template().fromNodeImage("24.14.1-bookworm")
    .runCmd("npm install -g pnpm@10.32.1", { user: "root" })
    .setUser("user").setWorkdir("/home/user")
    .runCmd("node --version && test \"$(pnpm --version)\" = 10.32.1");
  let build: BuildInfo | undefined;
  try {
    log("template-requested", { name, cpuCount: 2, memoryMB: 2048, nodeImage: "24.14.1-bookworm", pnpm: "10.32.1" });
    build = await Template.buildInBackground(template, name, { apiKey, cpuCount: 2, memoryMB: 2048 });
    await writeFile(stateFile, JSON.stringify(build, null, 2), { mode: 0o600, flag: "wx" });
    log("template-registered", build);
    const deadline = Date.now() + 20 * 60_000;
    let logsOffset = 0;
    while (Date.now() < deadline) {
      const status = await Template.getBuildStatus(build, { apiKey, logsOffset });
      logsOffset += status.logEntries.length;
      for (const entry of status.logEntries) log("template-build-log", entry);
      if (status.status === "ready") { log("template-ready", build); break; }
      if (status.status === "error") throw new Error(`template build failed: ${status.reason?.message}`);
      await new Promise(resolve => setTimeout(resolve, 3_000));
    }
    assert.equal((await Template.getBuildStatus(build, { apiKey, logsOffset })).status, "ready", "template build deadline exceeded");
    // Retained only while the follow-up smoke commands run; --cleanup removes it.
  } catch (error) {
    if (build) await remove(build);
    console.error(safe(error)); process.exitCode = 1;
  }
}
