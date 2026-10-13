import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const compiled = ts.transpileModule(await read("../src/lib/ensure-organization.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { createOrganizationInitializer } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const chatCompiled = ts.transpileModule(await read("../src/lib/chat-resource.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { threadResourceCustomUpdate, setStoredThreadResource } = await import(`data:text/javascript;base64,${Buffer.from(chatCompiled).toString("base64")}`);
const user = { id: "user-123456789", name: "Demo" };
const organization = { id: "workspace-1", name: "Workspace", slug: "workspace" };

function clientFixture(overrides = {}) {
  const calls = { list: 0, create: 0, setActive: 0 };
  return {
    calls,
    client: { organization: {
      list: async () => { calls.list++; return { data: [organization] }; },
      create: async () => { calls.create++; return { data: organization }; },
      setActive: async () => { calls.setActive++; return { data: {} }; },
      ...overrides,
    } },
  };
}

test("active session preserves its workspace without another list/set-active request", async () => {
  const { client, calls } = clientFixture();
  const initialize = createOrganizationInitializer(client);
  await initialize(user, "chosen-workspace");
  await initialize({ ...user }, "chosen-workspace");
  await initialize(null);
  assert.deepEqual(calls, { list: 0, create: 0, setActive: 0 });
});

test("concurrent mounts share initialization, and refreshed sessions stop initializing", async () => {
  const { client, calls } = clientFixture();
  const initialize = createOrganizationInitializer(client);
  const results = await Promise.all([initialize(user), initialize({ ...user }), initialize(user)]);
  assert.deepEqual(results, [organization, organization, organization]);
  await initialize({ ...user }, organization.id);
  assert.deepEqual(calls, { list: 1, create: 0, setActive: 1 });
});

test("a new user's concurrent mounts create only one workspace", async () => {
  const { client, calls } = clientFixture();
  client.organization.list = async () => { calls.list++; return { data: [] }; };
  const initialize = createOrganizationInitializer(client);
  await Promise.all([initialize(user), initialize({ ...user })]);
  assert.deepEqual(calls, { list: 1, create: 1, setActive: 1 });
});

test("listing failures do not create workspaces and allow a later retry", async () => {
  const { client, calls } = clientFixture();
  client.organization.list = async () => {
    calls.list++;
    return calls.list === 1 ? { error: { message: "offline" } } : { data: [organization] };
  };
  const initialize = createOrganizationInitializer(client);
  await assert.rejects(initialize(user), /offline/);
  await initialize(user);
  assert.deepEqual(calls, { list: 2, create: 0, setActive: 1 });
});

test("unsaved drafts never send custom metadata updates", () => {
  assert.equal(threadResourceCustomUpdate({ id: "draft", status: "new" }, "workspace"), null);
});

test("initialized conversations backfill metadata even after a local draft binding", () => {
  const original = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  try {
    setStoredThreadResource("draft", "table:one");
    assert.equal(threadResourceCustomUpdate({ id: "draft", status: "new" }, "table:one"), null);
    assert.deepEqual(threadResourceCustomUpdate({ id: "draft", status: "regular", custom: { agentId: "agent-1" } }, "table:one"), {
      agentId: "agent-1", resourceKey: "table:one",
    });
    assert.equal(threadResourceCustomUpdate({ id: "draft", status: "regular" }, "table:two"), null);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test("persisted metadata is neither repeatedly updated nor rebound to another resource", () => {
  const thread = { id: "saved", status: "regular", custom: { resourceKey: "table:one", agentId: "agent-1" } };
  assert.equal(threadResourceCustomUpdate(thread, "table:one"), null);
  assert.equal(threadResourceCustomUpdate(thread, "table:two"), null);
});

const html = await read("../index.html");
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
test("first paint uses the saved theme over OS preference, including invalid/blocked storage", () => {
  for (const stored of ["light", "dark", "system", "invalid", null]) {
    for (const osDark of [false, true]) {
      for (const blocked of [false, true]) {
        const classes = new Set();
        const root = { classList: { add: (value) => classes.add(value) }, style: {}, setAttribute: (key, value) => { root[key] = value; } };
        vm.runInNewContext(bootstrap, {
          localStorage: { getItem: () => { if (blocked) throw Error("storage blocked"); return stored; } },
          window: { matchMedia: () => ({ matches: osDark }) },
          document: { documentElement: root, getElementById: () => ({ setAttribute() {} }) },
        });
        const explicit = !blocked && ["light", "dark"].includes(stored);
        const expected = explicit ? stored : osDark ? "dark" : "light";
        assert.deepEqual([...classes], [expected]);
        assert.equal(root["data-theme"], expected);
        assert.equal(root.style.colorScheme, expected);
      }
    }
  }
});

const css = await read("../src/index.css");
test("Tailwind dark utilities and theme tokens share one class selector", () => {
  assert.match(css, /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/);
  assert.doesNotMatch(css, /@media\s*\(prefers-color-scheme/);
  assert.doesNotMatch(css, /\[data-theme=/);
});

function rgb(value) {
  if (value.startsWith("#")) return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16) / 255).concat(1);
  return value.match(/[\d.]+/g).map((channel, i) => Number(channel) / (i < 3 ? 255 : 1));
}
function composite(front, back) {
  return front.slice(0, 3).map((channel, i) => channel * front[3] + back[i] * (1 - front[3])).concat(1);
}
function luminance(color) {
  const linear = color.slice(0, 3).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear.reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(front, back) {
  const [low, high] = [luminance(composite(front, back)), luminance(back)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

test("core text, buttons, tinted notices and primary hover remain readable in both themes", () => {
  for (const selector of [":root", ".dark"]) {
    const block = css.split(`${selector} {`)[1].split("\n}")[0];
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)]
      .filter(([, , value]) => /^(#|rgba)/.test(value)).map(([, key, value]) => [key, rgb(value)]));
    for (const [front, back] of [["foreground", "background"], ["muted-foreground", "muted"], ["primary-foreground", "primary"], ["destructive-foreground", "destructive"], ["primary", "muted"]]) {
      assert.ok(contrast(tokens[front], tokens[back]) >= 4.5, `${selector} ${front}/${back}`);
    }
    for (const name of ["primary", "destructive", "warning", "agent", "success"]) {
      const tinted = composite(tokens[name].slice(0, 3).concat(0.1), tokens.background);
      assert.ok(contrast(tokens[name], tinted) >= 4.5, `${selector} ${name} notice/avatar`);
    }
    const hover = composite(tokens.primary.slice(0, 3).concat(0.9), tokens.background);
    assert.ok(contrast(tokens["primary-foreground"], hover) >= 4.5, `${selector} primary hover`);
  }
});
