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
    else if (entry.name.endsWith(".ts")) result.push(path);
  }
  return result;
}
const imports = source => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map(match => match[1]);

// Infrastructure packages own their contracts and implementations, without product dependencies.
for (const name of ["queue", "storage"]) {
  const directory = resolve(root, "packages", name);
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    assert(!dependency.startsWith("@tabdo/"), `${name}: infrastructure must not depend on product packages`);
  for (const file of await files(resolve(directory, "src"))) {
    const source = await readFile(file, "utf8");
    for (const specifier of imports(source))
      assert(!specifier.startsWith("@tabdo/"), `${file}: infrastructure must not import product packages`);
    assert(!/\bprocess\.env\b/.test(source), `${file}: configuration must be passed explicitly`);
  }
}

// Business services receive dependencies; concrete SDKs are assembled in Node entry points/runtime.
const backendDirectory = resolve(root, "packages/backend");
const backendConfig = JSON.parse(await readFile(resolve(backendDirectory, "tsconfig.json"), "utf8"));
assert.deepEqual(backendConfig.compilerOptions.types, [], "backend must not inherit host globals");
for (const file of await files(resolve(backendDirectory, "src"))) {
  const source = await readFile(file, "utf8");
  for (const specifier of imports(source)) {
    assert(!specifier.startsWith("node:") && !specifier.startsWith("@tabdo/agent-runtime")
      && !specifier.startsWith("@ai-sdk/harness") && !specifier.includes("apps/server"), `${file}: runtime/application import in backend: ${specifier}`);
    // The root exports contracts only; concrete infrastructure subpaths stay in the app.
    assert(!/^@tabdo\/(?:queue|storage)\//.test(specifier), `${file}: concrete infrastructure must be injected`);
    if (!file.includes("/src/http/")) assert(!specifier.startsWith("hono"), `${file}: HTTP transport must stay in thin http entries`);
  }
  assert(!/\b(?:getDatabase|getAuth|AsyncLocalStorage)\s*\(/.test(source), `${file}: services require explicit dependencies`);
  assert(!/\bprocess\.env\b/.test(source), `${file}: environment must be injected`);
}
for (const directory of ["packages/agent-runtime", "apps/server"]) {
  const manifest = JSON.parse(await readFile(resolve(root, directory, "package.json"), "utf8"));
  for (const name of ["just-bash", "@ai-sdk/sandbox-just-bash"])
    assert(!(name in (manifest.dependencies ?? {})), `${directory}: native execution must use real files and processes`);
}
for (const file of await files(resolve(root, "packages/agent-runtime/src"))) {
  const source = await readFile(file, "utf8");
  assert(!/\bprocess\.env\b/.test(source), `${file}: runtime configuration must be explicit`);
  for (const specifier of imports(source)) assert(!specifier.includes("apps/server"), `${file}: runtime must not import its application caller`);
}
console.log("Architecture boundaries passed: queue/storage independence, explicit business dependencies, Node Harness execution.");
