import assert from "node:assert/strict";
import { createBrowserFixture } from "./fixture.mjs";
const f = await createBrowserFixture({ name: "Platform Style Review" });
const { page, api } = f;
const goto = (p) => page.goto(f.frontend + p);
try {
  await goto("/app/settings");
  const report = await api("/reports", {
    name: "样式审查报告",
    description: "主题和紧凑布局",
    columns: 2,
    widgets: [
      {
        id: crypto.randomUUID(),
        type: "text",
        title: "业务说明",
        width: "full",
        content: "待办和来源说明。",
      },
    ],
  });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => localStorage.setItem("table-theme", t), theme);
    for (const [path, label] of [
      ["/app/settings", "settings"],
      ["/app/skills", "skills"],
      ["/app/skills/builtin%3Areport", "skill-detail"],
      ["/app/reports", "reports"],
      ["/app/reports/" + report.id, "report-builder"],
      ["/app/automations", "automations"],
      ["/app/automations/new", "automation-source"],
    ]) {
      await page.setViewportSize({ width: 700, height: 650 });
      await goto(path);
      await page.locator("header").waitFor();
      await page.waitForTimeout(250);
      await page.screenshot({
        animations: "disabled",
        path: f.artifact("platform-" + label + "-" + theme + ".png"),
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        label + " has no document overflow",
      );
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await goto("/app/reports");
  await page.getByRole("link", { name: /样式审查报告/ }).waitFor();
  await page.route("**/api/reports?*", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "报告刷新暂不可用" }),
    }),
  );
  await page.getByRole("button", { name: /刷新数据/ }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByRole("alert").count(),
    1,
    "report refresh failure visible with existing data",
  );
  await page.getByRole("link", { name: /样式审查报告/ }).waitFor();
  await page.unroute("**/api/reports?*");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "detached" });
  await page.route("**/api/automations*", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "自动化列表暂不可用" }),
    }),
  );
  await goto("/app/automations");
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByText("还没有自动化", { exact: true }).count(),
    0,
    "failed automation load is not empty state",
  );
  await page.unroute("**/api/automations*");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await page.getByText("还没有自动化", { exact: true }).waitFor();
  await goto("/app/skills/builtin%3Areport");
  await page.getByTestId("skill-explorer").waitFor();
  await page.setViewportSize({ width: 700, height: 650 });
  const files = page.getByRole("complementary", {
    name: "技能文件",
    exact: true,
  });
  assert(
    (await files.boundingBox()).height >= 128,
    "compact tree remains usable",
  );
  await files.getByRole("button", { name: "metrics.md", exact: true }).click();
  await page
    .getByRole("region", { name: "文件内容", exact: true })
    .getByText("references/metrics.md", { exact: true })
    .waitFor();
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("clipboard test denied")),
    }),
  );
  await page.getByRole("button", { name: "复制文件内容" }).click();
  await page.waitForTimeout(150);
  await page
    .getByText("复制失败，请检查浏览器权限后重试", { exact: true })
    .waitFor();
  assert.deepEqual(f.errors, [], "clipboard rejection is handled");
  await page.reload();
  await page.getByTestId("skill-explorer").waitFor();
  await f.ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "复制文件内容" }).click();
  await page.getByRole("button", { name: "文件内容已复制" }).waitFor();
  assert(
    (await page.evaluate(() => navigator.clipboard.readText())).includes(
      "报告页面",
    ),
  );
  await goto("/app/settings");
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  assert.equal(
    await page
      .getByRole("radio", { name: "深色", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  assert.equal(
    await page
      .getByRole("radio", { name: "深色", exact: true })
      .getAttribute("aria-checked"),
    "true",
    "theme remains selected",
  );
  assert.equal(await page.getByRole("switch").count(), 0, "general settings only exposes appearance and language");
  await page.getByRole("radio", { name: "浅色", exact: true }).click();
  assert.deepEqual(f.errors, [], "no page errors");
  console.log(
    "PASS: seven pages light/dark compact, report/automation error retry, Skill tree and copy failure/success, Settings persistence",
  );
} finally {
  await f.close();
}
