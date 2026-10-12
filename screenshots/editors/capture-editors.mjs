import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = "http://127.0.0.1:5173";
const TABLE = "0e697f4f-3b6b-4798-8ea6-7d1adf3d8a13";
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.evaluate(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const email = document.querySelector('input[type="email"]');
    const pass = document.querySelector('input[type="password"]');
    set.call(email, "demo@agrid.app");
    email.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(pass, "Demo1234!");
    pass.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname.startsWith("/app"), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
}

async function openTable() {
  await page.goto(`${BASE}/app/tables/${TABLE}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("[data-cell]", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
}

async function clickCell(colName, index = 0) {
  const ok = await page.evaluate(
    ({ colName, index }) => {
      const cells = [...document.querySelectorAll(`[data-cell][data-col-name="${colName}"]`)];
      const cell = cells[index];
      if (!cell) return false;
      cell.scrollIntoView({ block: "center", inline: "nearest" });
      cell.click();
      return true;
    },
    { colName, index }
  );
  return ok;
}

await login();
await openTable();
await page.screenshot({ path: path.join(OUT, "00-table.png") });

const shots = [
  ["状态", 1, "01-select-status"], // row with 进行中
  ["优先级", 0, "02-select-priority"],
  ["标签", 0, "03-multi-select"],
  ["截止日期", 0, "04-date"],
  ["负责人", 0, "05-person"],
  ["标题", 0, "06-text"],
  ["预估工时", 0, "07-number"],
  ["已完成", 0, "08-checkbox"],
];

for (const [name, idx, file] of shots) {
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 250));
  // click outside to close
  await page.mouse.click(10, 200);
  await new Promise((r) => setTimeout(r, 200));
  const ok = await clickCell(name, idx);
  console.log(name, ok);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, `${file}.png`) });
}

// dark date
await page.keyboard.press("Escape");
await page.mouse.click(10, 200);
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await new Promise((r) => setTimeout(r, 300));
await clickCell("截止日期", 1);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: path.join(OUT, "09-date-dark.png") });

await page.keyboard.press("Escape");
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await new Promise((r) => setTimeout(r, 300));
await clickCell("截止日期", 1);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: path.join(OUT, "10-date-light.png") });

// filter with priority chip
await page.keyboard.press("Escape");
await page.mouse.click(10, 200);
await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="filter-toggle"]');
  if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const add = [...document.querySelectorAll("button")].find((b) =>
    /添加条件/.test(b.textContent || "")
  );
  add?.click();
});
await new Promise((r) => setTimeout(r, 400));
// open value select if column already select-ish — change column to 优先级
await page.evaluate(async () => {
  const row = document.querySelector("[data-testid='filter-row']") || document.querySelector(".flex.flex-wrap.items-center.gap-2");
  const triggers = [...document.querySelectorAll("button")].filter((b) =>
    b.getAttribute("role") === "combobox" || b.className.includes("justify-between")
  );
  // first combobox in filter area
  const filterArea = [...document.querySelectorAll("div")].find((d) =>
    d.textContent?.includes("添加条件") && d.querySelectorAll('[role="combobox"]').length
  );
  const combos = filterArea
    ? [...filterArea.querySelectorAll('[role="combobox"]')]
    : [...document.querySelectorAll('[role="combobox"]')];
  if (combos[0]) {
    combos[0].click();
  }
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const item = [...document.querySelectorAll("[role='option']")].find((o) =>
    o.textContent?.includes("优先级")
  );
  item?.click();
});
await new Promise((r) => setTimeout(r, 300));
// open value dropdown
await page.evaluate(() => {
  const combos = [...document.querySelectorAll('[role="combobox"]')];
  const last = combos[combos.length - 1];
  last?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(OUT, "11-filter-priority.png") });

console.log("done");
await browser.close();
