import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const directory of ["packages/platform-node", "packages/agent-runtime", "apps/server"]) {
  const manifest = JSON.parse(await readFile(resolve(root, directory, "package.json"), "utf8"));
  for (const name of ["just-bash", "@ai-sdk/sandbox-just-bash"])
    assert(!(name in (manifest.dependencies ?? {})), `${directory}: native execution must use real files and processes`);
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.name.endsWith(".ts")) result.push(path);
  }
  return result;
}

for (const name of ["core", "platform-node"]) {
  const directory = resolve(root, "packages", name);
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const config = JSON.parse(await readFile(resolve(directory, "tsconfig.json"), "utf8"));
  assert.deepEqual(config.compilerOptions.types, name === "core" ? [] : ["node"], `${name}: runtime types must be isolated`);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    assert(!["@tabdo/backend", "@tabdo/shared", "@tabdo/agent-runtime"].includes(dependency), `${name}: framework must not depend on product packages`);
    if (name === "core") assert.fail(`core must not own runtime dependencies: ${dependency}`);
  }
  for (const file of await files(resolve(directory, "src"))) {
    const source = await readFile(file, "utf8");
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map(match => match[1]);
    for (const specifier of imports) {
      assert(!/^@tabdo\/(?:backend|shared|agent-runtime)(?:\/|$)/.test(specifier), `${file}: product import ${specifier}`);
      if (name === "core") assert(specifier.startsWith("."), `${file}: core import must be portable and local: ${specifier}`);
    }
    assert(!/\bprocess\.env\b/.test(source), `${file}: configuration must be passed explicitly`);
  }
}
const backendDirectory = resolve(root, "packages/backend");
const backendConfig = JSON.parse(await readFile(resolve(backendDirectory, "tsconfig.json"), "utf8"));
assert.deepEqual(backendConfig.compilerOptions.types, [], "backend must not load host runtime ambient globals");
for (const file of await files(resolve(backendDirectory, "src"))) {
  const source = await readFile(file, "utf8");
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map(match => match[1]);
  for (const specifier of imports) {
    assert(!specifier.startsWith("node:")
      && !/^@tabdo\/(?:platform-node|agent-runtime)(?:\/|$)/.test(specifier)
      && !specifier.startsWith("@ai-sdk/harness") && !specifier.includes("apps/server"), `${file}: runtime/application import in backend: ${specifier}`);
    if (!file.includes("/src/http/")) assert(!specifier.startsWith("hono"), `${file}: HTTP transport must stay in thin http entries`);
  }
  assert(!/\b(?:getDatabase|getAuth|AsyncLocalStorage)\s*\(/.test(source), `${file}: services require explicit dependencies`);
  assert(!/\bprocess\.env\b/.test(source), `${file}: environment must be injected`);
}
const executorDirectory = resolve(root,"packages/agent-runtime");
const executorConfig = JSON.parse(await readFile(resolve(executorDirectory,"tsconfig.json"),"utf8"));
assert.deepEqual(executorConfig.compilerOptions.types,[],"executor must not inherit host runtime globals");
for (const file of await files(resolve(executorDirectory,"src"))) {
  const source = await readFile(file,"utf8");
  for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s*["']([^"']+)["']/g)) {
    const [,typeOnly,specifier] = match;
    assert(!specifier.startsWith("node:"),`${file}: platform execution effect must be injected`);
    if (specifier.startsWith("@tabdo/platform-node")) assert(typeOnly,`${file}: executor may only refer to host types`);
  }
  assert(!/\bprocess\.|\bBuffer\s*[.(]/.test(source),`${file}: executor must use explicit ports and Web APIs`);
}
console.log("Architecture boundaries passed: portable core, isolated implementations, explicit backend dependencies.");
