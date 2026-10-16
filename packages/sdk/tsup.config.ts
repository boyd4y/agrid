import { defineConfig } from "tsup";
export default defineConfig({ entry: { index: "src/index.ts", tabdo: "src/index.ts" }, format: ["esm"], platform: "browser", target: "es2022",
  splitting: false, clean: true, dts: { entry: "src/index.ts", resolve: ["@tabdo/shared"], compilerOptions: { baseUrl: ".", paths: { "@tabdo/shared": ["../shared/src/index.ts"] }, rootDir: ".." } },
});
