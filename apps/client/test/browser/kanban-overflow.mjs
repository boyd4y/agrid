import assert from "node:assert/strict";
import { createBrowserFixture } from "./fixture.mjs";
const fixture = await createBrowserFixture({ name: "Kanban overflow" });
const { page, api, frontend, errors } = fixture;
const command = async (command, input) => (await api("/commands", { command, input })).result;
try {
  const table = await api("/tables", { name: "Long card values" });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const note = await api(`/tables/${table.id}/columns`, { name: "描述", type: "text" });
  const status = await api(`/tables/${table.id}/columns`, { name: "状态", type: "select", config: { options: [{ id: "todo", label: "待办" }, { id: "done", label: "完成" }] } });
  const values = ["用户在结账时偶尔会遇到付款失败问题。".repeat(30), "longunbrokenword".repeat(100), "多行描述\n".repeat(50)];
  const rows = [];
  for (const [index, value] of values.entries()) rows.push(await api(`/tables/${table.id}/rows`, { cells: { [title.id]: `卡片${index}`, [note.id]: value, [status.id]: "todo" } }));
  const board = await command("createBoardView", { tableId: table.id, name: "Overflow board", config: { statusColumnId: status.id, visibleColumnIds: [note.id], density: "comfortable" } });
  await command("setDefaultView", { viewId: board.id });
  for (const density of ["comfortable", "compact"]) {
    await command("updateBoardView", { viewId: board.id, config: { density } });
    await page.goto(frontend + `/app/tables/${table.id}`);
    await page.locator('[data-testid="board-card"]').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="board-card"]').length === 3);
    const measured = await page.locator(`[data-card-property="${note.id}"] [data-card-value] > span`).evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(), card = element.closest('[data-testid="board-card"]').getBoundingClientRect(), style = getComputedStyle(element);
      return { display: style.display, overflow: style.overflowX, ellipsis: style.textOverflow, nowrap: style.whiteSpace, fits: rect.right <= card.right && rect.left >= card.left, clipped: element.scrollWidth > element.clientWidth };
    }));
    assert.equal(measured.length, 3);
    for (const value of measured) assert.deepEqual(value, { display: "block", overflow: "hidden", ellipsis: "ellipsis", nowrap: "nowrap", fits: true, clipped: true });
  }
  await page.locator(`[data-row-id="${rows[0].id}"] [data-card-value]`).click();
  await page.getByTestId("related-record-panel").waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: Chinese, unbroken text and newlines use bounded ellipsis at both card densities; details still open.");
} finally { await fixture.close(); }
