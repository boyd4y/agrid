import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

// tsx already pins esbuild in the image lockfile. Resolve from its own install
// tree, including when npm does not hoist that transitive dependency.
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild", { paths: [dirname(require.resolve("tsx"))] }));
const directory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(directory, "../../../..");
const outdir = resolve(directory, "dist");
const result = await esbuild.build({
  absWorkingDir: workspace,
  entryPoints: { entry: resolve(directory, "entry.ts"), execute: resolve(directory, "execute.ts") },
  outdir, outExtension: { ".js": ".mjs" },
  bundle: true, platform: "node", format: "esm", target: "node24",
  packages: "external", conditions: ["development"], metafile: true,
  plugins: [{
    name: "workspace-source-only",
    setup(build) {
      build.onResolve({ filter: /^@tabdo\// }, args => {
        const path = fileURLToPath(import.meta.resolve(args.path));
        if (!path.startsWith(`${resolve(workspace, "packages")}/`) || !path.endsWith(".ts"))
          throw new Error("Runtime build requires workspace TypeScript source exports; run with --conditions=development");
        return { path };
      });
    },
  }],
});

// Third-party packages must retain their own module/resource paths. In
// particular, never inline native Pi provider loading or just-bash WASM assets.
for (const path of Object.keys(result.metafile.inputs)) {
  const absolute = resolve(workspace, path);
  if (![resolve(workspace, "packages"), directory].some(root => absolute.startsWith(`${root}/`)))
    throw new Error(`Unexpected non-workspace runtime input: ${relative(workspace, absolute)}`);
}
for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(value => value.external && value.path.startsWith("@tabdo/")))
    throw new Error("Runtime build left an unresolved workspace package");
}
await writeFile(resolve(outdir, "build-meta.json"), `${JSON.stringify(result.metafile, null, 2)}\n`);
console.info(`Native runtime: compiled ${Object.keys(result.metafile.inputs).length} workspace modules; SDK packages remain external.`);
