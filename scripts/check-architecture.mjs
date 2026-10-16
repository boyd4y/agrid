import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.tsx?$/.test(entry.name)) result.push(path);
  }
  return result;
}
const imports = source => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map(match => match[1]);
const boundaries = {
  core: [], db: [], auth: ["core"], queue: [], worker: ["queue"], storage: [], "agent-runtime": ["core"], shared: [], ui: [], sdk: ["shared"],
};
const graph = new Map();
for (const [name, allowed] of Object.entries(boundaries)) {
  const directory = resolve(root, "packages", name);
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const dependencies = Object.keys(manifest.dependencies ?? {}).filter(value => value.startsWith("@tabdo/"));
  graph.set(name, dependencies.map(value => value.slice("@tabdo/".length)));
  if (name === "worker") assert(dependencies.includes("@tabdo/queue"), "worker must depend on queue");
  if (["worker"].includes(name)) for (const dependency of ["bullmq", "ioredis", "@tabdo/shared", "@tabdo/agent-runtime"])
    assert(!(dependency in (manifest.dependencies ?? {})), `${name}: invalid infrastructure dependency ${dependency}`);
  for (const dependency of dependencies)
    assert(allowed.includes(dependency.slice("@tabdo/".length)), `${name}: invalid package dependency ${dependency}`);
  for (const file of await files(resolve(directory, "src"))) {
    const source = await readFile(file, "utf8");
    for (const specifier of imports(source)) {
      assert(!specifier.includes("apps/"), `${file}: a package must not import an application`);
      if (specifier.startsWith(".")) assert(!resolve(file, "..", specifier).startsWith(resolve(root, "apps")), `${file}: application-relative import`);
      const dependency = /^@tabdo\/([^/]+)/.exec(specifier)?.[1];
      if (dependency && dependency !== name) assert(allowed.includes(dependency), `${file}: invalid package import ${specifier}`);
      if (name === "worker") assert(!/^@tabdo\/queue\//.test(specifier), `${file}: worker depends on queue contracts, not concrete providers`);
    }
    assert(!/\bprocess\.env\b/.test(source), `${file}: configuration must be explicit`);
  }
}
function visit(name, path = []) {
  assert(!path.includes(name), `Package cycle: ${[...path, name].join(" -> ")}`);
  for (const next of graph.get(name) ?? []) visit(next, [...path, name]);
}
for (const name of graph.keys()) visit(name);
const serverManifest = JSON.parse(await readFile(resolve(root, "apps/server/package.json"), "utf8"));
for (const dependency of ["bullmq", "ioredis"])
  assert(!(dependency in (serverManifest.dependencies ?? {})), `server: queue owns ${dependency}`);
for (const name of ["apps/server/src", "packages/worker/src"]) for (const file of await files(resolve(root, name))) {
  for (const specifier of imports(await readFile(file, "utf8")))
    assert(!/^(?:bullmq|ioredis)(?:\/|$)/.test(specifier), `${file}: queue infrastructure belongs in @tabdo/queue`);
}
for (const file of await files(resolve(root, "apps/server/src/business"))) {
  const source = await readFile(file, "utf8");
  assert(!/\bprocess\.env\b/.test(source), `${file}: business services receive configuration`);
  assert(!/\b(?:getDatabase|getAuth|AsyncLocalStorage)\s*\(/.test(source), `${file}: business services receive resources`);
  for (const specifier of imports(source)) {
    assert(!specifier.startsWith("node:"), `${file}: business services must not acquire Node resources`);
    assert(!specifier.startsWith("@ai-sdk/harness") && !specifier.startsWith("@tabdo/agent-runtime"), `${file}: native execution belongs in server/harness`);
    assert(!/^@tabdo\/(?:queue|storage)\//.test(specifier), `${file}: concrete infrastructure must be injected`);
    if (!file.includes("/business/http/")) assert(!specifier.startsWith("hono"), `${file}: Hono belongs in HTTP entries`);
  }
}
for (const directory of ["packages/agent-runtime", "apps/server"]) {
  const manifest = JSON.parse(await readFile(resolve(root, directory, "package.json"), "utf8"));
  for (const name of ["just-bash", "@ai-sdk/sandbox-just-bash"])
    assert(!(name in (manifest.dependencies ?? {})), `${directory}: use real files and processes`);
}
console.log("Architecture boundaries passed: independent core/db/queue/storage, worker depends on queue, auth and Harness capabilities, application-owned business; no package cycles.");
