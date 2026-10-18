import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the real pages, hook and initializer together. Only React's rendering
// boundary, routing, translation and the HTTP client are in-memory fixtures.
const sources = Object.fromEntries(await Promise.all([
  ["@/lib/ensure-organization", "lib/ensure-organization.ts"],
  ["@/hooks/useAuth", "hooks/useAuth.ts"],
  ["LoginPage", "pages/LoginPage.tsx"],
  ["SignupPage", "pages/SignupPage.tsx"],
].map(async ([id, path]) => [id, ts.transpileModule(
  await readFile(new URL(`../src/${path}`, import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText])));

const user = { id: "fresh-user-123456", name: "Fresh user", email: "fresh@example.test" };
const organization = { id: "workspace-first", name: "Workspace", slug: "workspace" };
const sessionData = (activeOrganizationId = null, sessionUser = user) => ({
  user: sessionUser, session: { activeOrganizationId },
});

function fixture({ activeOrganizationId = null, hookData = null, authUser = user, organizations = [organization] } = {}) {
  const calls = { auth: [], session: [], list: 0, create: [], setActive: [], refetch: 0, navigation: [], warnings: [] };
  let currentSession = sessionData(activeOrganizationId);
  const refetch = async () => { calls.refetch++; hookData = currentSession; };
  const client = {
    useSession: () => ({ data: hookData, isPending: false, error: null, refetch }),
    getSession: async (options) => { calls.session.push(options); return { data: currentSession }; },
    signIn: { email: async (input) => { calls.auth.push(input); return { data: { user: authUser } }; } },
    signUp: { email: async (input) => { calls.auth.push(input); return { data: { user: authUser } }; } },
    organization: {
      list: async () => { calls.list++; return { data: organizations }; },
      create: async (input) => { calls.create.push(input); return { data: organization }; },
      setActive: async (input) => {
        calls.setActive.push(input);
        currentSession = sessionData(input.organizationId);
        return { data: organization };
      },
    },
  };
  const i18n = { t: (key, options) => options ? `${key}:${options.name}` : key };
  let renderState;
  const react = {
    useCallback: (callback) => callback,
    useState: (initial) => {
      const owner = renderState;
      const slot = owner.cursor++;
      if (!(slot in owner.slots)) owner.slots[slot] = initial;
      return [owner.slots[slot], (value) => { owner.slots[slot] = value; }];
    },
    useRef: (initial) => {
      const owner = renderState;
      const slot = owner.cursor++;
      return owner.slots[slot] ??= { current: initial };
    },
  };
  const element = (type, props) => ({ type, props });
  const modules = {
    react,
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "lucide-react": { ArrowRight: "ArrowRight", LoaderCircle: "LoaderCircle" },
    "react-router-dom": {
      Link: "Link", useNavigate: () => (...args) => calls.navigation.push(args),
      useLocation: () => ({ state: { from: "/invite/test-invitation" } }),
    },
    "react-i18next": { useTranslation: () => ({ t: i18n.t }) },
    "@/i18n": { default: i18n },
    "@/lib/auth-client": { authClient: client },
    "@tabdo/ui/components/button": { Button: "Button" },
    "@tabdo/ui/components/input": { Input: "Input" },
    "@tabdo/ui/components/field": Object.fromEntries(
      ["Field", "FieldDescription", "FieldError", "FieldGroup", "FieldLabel"].map((key) => [key, key]),
    ),
    "@/components/auth/GoogleSignIn": { GoogleSignIn: "GoogleSignIn" },
  };
  const load = (id) => {
    if (modules[id]) return modules[id];
    assert.ok(sources[id], `Unexpected module: ${id}`);
    const exports = {};
    vm.runInNewContext(sources[id], {
      exports, require: load, Error, console: { warn: (...args) => calls.warnings.push(args) },
    }, { filename: id });
    modules[id] = exports;
    return exports;
  };
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    return [node.props?.children].flat(Infinity).map((child) => find(child, predicate)).find(Boolean);
  };
  const page = (name) => {
    const Component = load(name)[name];
    const state = { slots: [], cursor: 0 };
    const render = () => {
      renderState = state;
      state.cursor = 0;
      return Component();
    };
    return {
      form: () => find(render(), (node) => node.type === "form"),
      error: () => find(render(), (node) => node.type === "FieldError")?.props.children,
      change: (id, value) => find(render(), (node) => node.props?.id === id).props.onChange({ target: { value } }),
      submit: () => find(render(), (node) => node.type === "form").props.onSubmit({ preventDefault() {} }),
    };
  };
  return { client, calls, page, hook: () => load("@/hooks/useAuth").useAuth() };
}

for (const pageName of ["LoginPage", "SignupPage"]) {
  const prefix = pageName === "LoginPage" ? "login" : "signup";
  const target = pageName === "LoginPage" ? "/invite/test-invitation" : "/app";

  test(`${pageName}: submitted user replaces the stale render's user and preserves navigation`, async () => {
    const f = fixture({ hookData: sessionData("stale-workspace", { ...user, id: "old-user", name: "Old user" }), organizations: [] });
    const page = f.page(pageName);
    page.change(`${prefix}-email`, "typed@example.test");
    page.change(`${prefix}-password`, "password-123");
    if (prefix === "signup") page.change("signup-name", "Typed name");
    await page.submit();
    assert.equal(f.calls.auth[0].email, "typed@example.test");
    assert.equal(f.calls.auth[0].password, "password-123");
    assert.equal(f.calls.create.length, 1);
    assert.equal(f.calls.create[0].name, "common:myWorkspace:Fresh user");
    assert.equal(f.calls.create[0].slug, `ws-${user.id.slice(0, 8)}`);
    assert.equal(f.calls.setActive[0].organizationId, organization.id);
    assert.equal(f.calls.session[0].query.disableCookieCache, true);
    assert.equal(f.calls.refetch, 1);
    assert.equal(page.error(), undefined);
    assert.equal(page.form().props["aria-busy"], false);
    assert.equal(f.calls.navigation[0][0], target);
    assert.equal(f.calls.navigation[0][1].replace, true);
  });

  test(`${pageName}: the latest selected workspace short-circuits all organization requests`, async () => {
    const f = fixture({ activeOrganizationId: "chosen-workspace" });
    await f.page(pageName).submit();
    assert.equal(f.calls.list, 0);
    assert.equal(f.calls.create.length, 0);
    assert.equal(f.calls.setActive.length, 0);
    assert.equal(f.calls.navigation[0][0], target);
  });

  test(`${pageName}: a missing auth response user falls back to the fresh session, never the render`, async () => {
    const f = fixture({ authUser: null, organizations: [] });
    await f.page(pageName).submit();
    assert.equal(f.calls.create[0].slug, `ws-${user.id.slice(0, 8)}`);
    assert.equal(f.calls.navigation[0][0], target);
  });

  for (const stage of ["list", "create", "setActive"]) {
    for (const message of [`${stage} unavailable`, ""]) {
      test(`${pageName}: ${stage} returned error (${message || "localized fallback"}) stays on the form and allows retry`, async () => {
        const f = fixture({ organizations: stage === "create" ? [] : [organization] });
        const original = f.client.organization[stage];
        let attempts = 0;
        f.client.organization[stage] = async (...args) => {
          if (attempts++ === 0) return { error: { message } };
          return original(...args);
        };
        const page = f.page(pageName);
        await page.submit();
        const fallback = { list: "orgLoadFailed", create: "orgCreateFailed", setActive: "orgSelectFailed" }[stage];
        assert.equal(page.error(), message || `common:${fallback}`);
        assert.equal(page.form().props["aria-describedby"], `${prefix}-error`);
        assert.equal(page.form().props["aria-busy"], false);
        assert.equal(f.calls.navigation.length, 0);
        assert.equal(f.calls.warnings.length, 0, "foreground errors must reach the form");
        if (stage === "list") assert.equal(f.calls.create.length, 0, "list error must never trigger create");
        if (stage !== "setActive") assert.equal(f.calls.setActive.length, 0);
        await page.submit();
        assert.equal(page.error(), undefined);
        assert.equal(f.calls.navigation[0][0], target);
      });
    }
  }

  test(`${pageName}: thrown organization failures reach the form`, async () => {
    const f = fixture();
    f.client.organization.list = async () => { throw new Error("network disconnected"); };
    const page = f.page(pageName);
    await page.submit();
    assert.equal(page.error(), "network disconnected");
    assert.equal(f.calls.navigation.length, 0);
    assert.equal(f.calls.create.length, 0);
  });

  for (const response of [{ error: { message: "session unavailable" } }, { data: null }]) {
    test(`${pageName}: unreadable fresh session cannot use a stale selected workspace`, async () => {
      const f = fixture({ hookData: sessionData("stale-workspace") });
      f.client.getSession = async () => response;
      const page = f.page(pageName);
      await page.submit();
      assert.equal(page.error(), response.error?.message || "common:orgLoadFailed");
      assert.equal(f.calls.list, 0);
      assert.equal(f.calls.navigation.length, 0);
    });
  }

  test(`${pageName}: authentication errors retain existing feedback without organization requests`, async () => {
    const f = fixture();
    f.client[prefix === "login" ? "signIn" : "signUp"].email = async () => ({ error: { message: "invalid credentials" } });
    const page = f.page(pageName);
    await page.submit();
    assert.equal(page.error(), "invalid credentials");
    assert.equal(f.calls.session.length, 0);
    assert.equal(f.calls.list, 0);
    assert.equal(f.calls.navigation.length, 0);
  });
}

test("login, signup and background hook instances share the same in-flight initializer", async () => {
  const f = fixture({ hookData: sessionData(), organizations: [] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.client.organization.list = async () => { f.calls.list++; await gate; return { data: [] }; };
  const login = f.page("LoginPage");
  const signup = f.page("SignupPage");
  const background = f.hook().ensureOrganization();
  const submitting = [login.submit(), signup.submit()];
  await Promise.resolve();
  assert.equal(login.form().props["aria-busy"], true);
  await login.submit(); // Duplicate submissions from the same form are ignored.
  assert.equal(f.calls.auth.length, 2);
  assert.equal(f.calls.list, 1);
  release();
  await Promise.all([background, ...submitting]);
  assert.equal(f.calls.create.length, 1);
  assert.equal(f.calls.setActive.length, 1);
  assert.equal(f.calls.navigation.length, 2);
});

test("background initialization keeps its warning handling and can retry after a shared foreground failure", async () => {
  const f = fixture({ hookData: sessionData() });
  const original = f.client.organization.list;
  f.client.organization.list = async () => ({ error: { message: "offline" } });
  const background = f.hook().ensureOrganization();
  const foreground = f.hook().ensureOrganizationForUser(user);
  assert.equal(await background, null);
  await assert.rejects(foreground, /offline/);
  assert.equal(f.calls.warnings.length, 1);
  f.client.organization.list = original;
  await f.hook().ensureOrganizationForUser(user);
  assert.equal(f.calls.setActive.length, 1);
});
