import assert from "node:assert/strict";
import { createBrowserFixture } from "./fixture.mjs";

const fixture = await createBrowserFixture({ name: "Kanban drag browser" });
const { page, api, frontend, errors, artifact } = fixture;
const command = async (command, input) =>
  (await api("/commands", { command, input })).result;
try {
  const table = await api("/tables", { name: "Real drag source" });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const note = await api(`/tables/${table.id}/columns`, {
    name: "说明",
    type: "text",
  });
  const status = await api(`/tables/${table.id}/columns`, {
    name: "状态",
    type: "select",
    config: {
      options: [
        { id: "todo", label: "待办", color: "blue" },
        { id: "done", label: "完成", color: "green" },
      ],
    },
  });
  const first = await api(`/tables/${table.id}/rows`, {
    cells: {
      [title.id]: "第一张卡片",
      [note.id]: "可以从正文拖动",
      [status.id]: "todo",
    },
  });
  const second = await api(`/tables/${table.id}/rows`, {
    cells: {
      [title.id]: "第二张卡片",
      [note.id]: "详情打开仍可拖动",
      [status.id]: "todo",
    },
  });
  const board = await command("createBoardView", {
    tableId: table.id,
    name: "Drag board",
    config: {
      statusColumnId: status.id,
      visibleColumnIds: [note.id],
      density: "compact",
    },
  });
  await command("setDefaultView", { viewId: board.id });
  await page.goto(frontend + `/app/tables/${table.id}`);
  const card = (id) =>
    page.locator(`[data-testid="board-card"][data-row-id="${id}"]`);
  const sheet = page.getByTestId("related-record-panel");
  await card(first.id).waitFor();
  await page.evaluate(() => {
    window.dragTrace = [];
    for (const type of [
      "pointerdown",
      "dragstart",
      "dragover",
      "drop",
      "dragend",
    ])
      document.addEventListener(type, (event) => {
        if (type !== "dragover" || window.dragTrace.at(-1)?.type !== type)
          window.dragTrace.push({
            type,
            target: event.target.outerHTML?.slice(0, 180),
            prevented: event.defaultPrevented,
          });
      });
  });
  const move = async (id, group, sourcePosition) => {
    const response = page
      .waitForResponse(
        (response) =>
          response.url().endsWith(`/api/rows/${id}`) &&
          response.request().method() === "PATCH",
        { timeout: 10000 },
      )
      .then(
        (response) => response,
        (error) => error,
      );
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    const source =
      sourcePosition.y > 30
        ? card(id).locator("[data-card-property]").last()
        : card(id).locator("h3");
    await source.dragTo(page.locator(`[data-kanban-group="${group}"]`), {
      targetPosition: { x: 150, y: 75 },
    });
    const moved = await response;
    if (moved instanceof Error) throw moved;
    assert(moved.ok(), "native browser drag patches the record");
    assert.equal(
      (await command("getRow", { rowId: id })).cells[status.id],
      group,
    );
    await page
      .locator(`[data-kanban-group="${group}"] [data-row-id="${id}"]`)
      .waitFor();
    await page.waitForLoadState("networkidle");
  };
  await move(first.id, "done", { x: 140, y: 18 });
  assert.equal(await sheet.count(), 0, "native drag does not open details");
  await card(first.id).click();
  await sheet
    .locator('input[value="第一张卡片"]')
    .waitFor();
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).pointerEvents),
    "auto",
    "nonmodal Sheet does not block the board",
  );
  await move(second.id, "done", { x: 140, y: 18 });
  await sheet
    .locator('input[value="第一张卡片"]')
    .waitFor();
  await page.screenshot({
    path: artifact("kanban-drag-sheet-open.png"),
    animations: "disabled",
  });
  await sheet.getByRole("button", { name: "关闭记录", exact: true }).click();
  await sheet.waitFor({ state: "hidden" });
  await move(second.id, "todo", { x: 160, y: 40 });
  assert.equal(
    await sheet.count(),
    0,
    "drag after closing Sheet does not open another Sheet",
  );
  await card(second.id).click();
  await sheet
    .locator('input[value="第二张卡片"]')
    .waitFor();
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
  await card(second.id).focus();
  await page.keyboard.press("Enter");
  await sheet
    .locator('input[value="第二张卡片"]')
    .waitFor();
  await page.reload();
  await page
    .locator(`[data-kanban-group="done"] [data-row-id="${first.id}"]`)
    .waitFor();
  await page
    .locator(`[data-kanban-group="todo"] [data-row-id="${second.id}"]`)
    .waitFor();
  assert.equal(await card(first.id).getAttribute("data-density"), "compact");
  const menu = () =>
    card(second.id).getByRole("button", {
      name: "卡片操作：第二张卡片",
      exact: true,
    });
  let controlPatches = 0;
  const observeControl = (request) => {
    if (
      request.url().endsWith(`/api/rows/${second.id}`) &&
      request.method() === "PATCH"
    )
      controlPatches++;
  };
  page.on("request", observeControl);
  await card(second.id).hover();
  const control = await menu().boundingBox(),
    destination = await page
      .locator('[data-kanban-group="done"]')
      .boundingBox();
  await page.mouse.move(
    control.x + control.width / 2,
    control.y + control.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(destination.x + 150, destination.y + 75, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.waitForLoadState("networkidle");
  page.off("request", observeControl);
  assert.equal(
    controlPatches,
    0,
    "dragging the interactive menu does not move the card",
  );
  assert.equal(
    (await command("getRow", { rowId: second.id })).cells[status.id],
    "todo",
  );
  assert.equal(await sheet.count(), 0);
  let menuCaptured = false;
  const openDelete = async () => {
    await menu().click();
    if (!menuCaptured) {
      await page.screenshot({
        path: artifact("kanban-card-menu.png"),
        animations: "disabled",
      });
      menuCaptured = true;
    }
    await page.getByRole("menuitem", { name: "删除卡片", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "删除卡片？", exact: true })
      .waitFor();
    assert.equal(await sheet.count(), 0, "card menu does not open details");
  };
  await openDelete();
  await page.screenshot({
    path: artifact("kanban-delete-confirmation.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await card(second.id).waitFor();
  assert.equal(
    (await command("getRow", { rowId: second.id })).cells[status.id],
    "todo",
  );
  await openDelete();
  const rejectDelete = async (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "卡片删除暂不可用" }),
        })
      : route.fallback();
  await page.route(`**/api/rows/${second.id}`, rejectDelete);
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("alert")
    .getByText("卡片删除暂不可用", { exact: true })
    .waitFor();
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "卡片删除暂不可用" })
    .waitFor();
  assert.equal(
    (await command("getRow", { rowId: second.id })).cells[status.id],
    "todo",
  );
  await page.unroute(`**/api/rows/${second.id}`, rejectDelete);
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  await card(second.id).waitFor({ state: "hidden" });
  assert.equal((await api(`/tables/${table.id}`)).rowCount, 1);
  await page.reload();
  await card(first.id).waitFor();
  assert.equal(
    await card(second.id).count(),
    0,
    "deleted record remains deleted after reload",
  );
  await page.screenshot({
    path: artifact("kanban-delete-restored.png"),
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS native whole-card title/body drag before/open/closed Sheet, status persistence, control drag protection, hover menu delete cancel/failure/retry/reload, no accidental details, click/keyboard details",
  );
} catch (error) {
  console.log(await page.evaluate(() => window.dragTrace));
  await page.screenshot({
    path: artifact("kanban-drag-failure.png"),
    animations: "disabled",
  });
  throw error;
} finally {
  await fixture.close();
}
