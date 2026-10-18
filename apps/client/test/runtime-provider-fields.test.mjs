import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/components/agents/AgentConfigurationFields.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Run the real form component with inert UI primitives. Inspect the controlled
// values and disabled props without starting a browser or changing form state.
function formFixture(strings) {
  const controls = [];
  const primitive = name => props => {
    controls.push({ name, props });
    return createElement("div", null, props.children);
  };
  const primitives = new Proxy({}, { get: (_, name) => primitive(name) });
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => {
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-i18next") return { useTranslation: () => ({ t: key => strings[key] ?? key }) };
    if (id.startsWith("@tabdo/ui/components/")) return primitives;
    if (id === "lucide-react") return primitives;
    if (id === "@/components/icons/HarnessLogos") return { HarnessLogo: () => null };
    if (id === "@/components/skills/SkillPicker") return { SkillPicker: () => null };
    if (id === "@/components/members/AvatarPicker") return { AvatarPicker: () => null };
    throw new Error(`Unexpected import: ${id}`);
  } });
  return { Component: exports.AgentBasicFields, controls };
}

for (const locale of ["en", "zh-CN"]) {
  const strings = JSON.parse(await readFile(new URL(`../src/i18n/locales/${locale}/agents.json`, import.meta.url), "utf8"));
  test(`${locale}: reopening a gated Railway configuration shows its reason and preserves the provider`, () => {
    for (const harness of ["codex", "claude"]) {
      const { Component, controls } = formFixture(strings), changes = [];
      const value = { name: "Saved agent", image: null, persona: "Use tools", harness, model: "fixture", runtime: "sandbox", sandboxProvider: "railway" };
      const html = renderToStaticMarkup(createElement(Component, { value, onChange: patch => changes.push(patch), harnessLocked: true,
        harnesses: [{ id: harness, label: harness, available: true, models: [{ id: "fixture", label: "Fixture" }],
          runtimeModes: ["local", "sandbox"], defaultRuntime: "local", runtimeProviders: [
            { id: "vercel", available: true },
            { id: "railway", available: false, reason: "railway_harness_unavailable", hint: "server fallback" },
          ] }],
      }));
      assert(html.includes(strings.railwayHarnessUnavailable));
      assert(!html.includes("server fallback"));
      assert(controls.some(({ name, props }) => name === "Select" && props.value === "railway"));
      assert(controls.some(({ name, props }) => name === "SelectItem" && props.value === "railway" && props.disabled === true));
      assert.equal(value.sandboxProvider, "railway");
      assert.deepEqual(changes, []);
    }
  });

  test(`${locale}: Railway displays configuration hints and uses metadata for availability`, () => {
    for (const status of [{ available: true }, { available: false, hint: "Missing dedicated environment" }]) {
      const { Component, controls } = formFixture(strings);
      const html = renderToStaticMarkup(createElement(Component, {
        value: { name: "Agent", persona: "Tools", harness: "pi", model: "fixture", runtime: "sandbox", sandboxProvider: "railway" },
        onChange: () => assert.fail("render must preserve configuration"), harnessLocked: false,
        harnesses: [{ id: "pi", label: "Pi", available: true, models: [], runtimeModes: ["sandbox"],
          defaultRuntime: "sandbox", runtimeProviders: [{ id: "railway", ...status }] }],
      }));
      assert(!html.includes(strings.railwayHarnessUnavailable));
      if (status.hint) assert(html.includes(status.hint));
      assert(!controls.some(({ name }) => name === "Select"), "singleton provider is hidden");
    }
  });
}

test("create forms show only available choices and hide singleton selectors", () => {
  for (const providers of [
    [{ id: "local", available: true }],
    [{ id: "e2b", available: true }],
    [{ id: "local", available: true }, { id: "e2b", available: true }],
    [{ id: "e2b", available: true }, { id: "railway", available: true }],
  ]) {
    const { Component, controls } = formFixture({});
    const runtime = providers.some(p => p.id !== "local") ? "sandbox" : "local";
    renderToStaticMarkup(createElement(Component, {
      value: { name: "New", persona: "Tools", harness: "pi", model: "__harness_default__", runtime, sandboxProvider: "e2b" },
      onChange: () => assert.fail("render must not change defaults"),
      harnesses: [{ id: "pi", available: true, models: [], runtimeModes: ["local", "sandbox"],
        runtimeProviders: [...providers, { id: "vercel", available: false }], defaultRuntime: runtime }],
    }));
    const triggers = controls.filter(c => c.name === "SelectTrigger").map(c => c.props.id);
    assert(!triggers.includes("agent-harness"));
    assert(!triggers.includes("agent-model"));
    assert.equal(triggers.includes("agent-runtime"), providers.some(p => p.id === "local") && providers.some(p => p.id !== "local"));
    assert.equal(triggers.includes("agent-sandbox-provider"), providers.filter(p => p.id !== "local").length > 1);
    assert(!controls.some(c => c.name === "SelectItem" && c.props.value === "vercel"));
  }
});
