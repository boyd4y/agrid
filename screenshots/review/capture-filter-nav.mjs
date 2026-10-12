import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = "http://127.0.0.1:5173";
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

function setInput(el, value) {
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 15000 });
await page.evaluate(() => {
  const email = document.querySelector('input[type="email"]');
  const pass = document.querySelector('input[type="password"]');
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  set.call(email, "demo@agrid.app");
  email.dispatchEvent(new Event("input", { bubbles: true }));
  set.call(pass, "Demo1234!");
  pass.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click('button[type="submit"]');
await page.waitForFunction(() => location.pathname.startsWith("/app"), {
  timeout: 20000,
});
await new Promise((r) => setTimeout(r, 1200));

await page.goto(`${BASE}/app/tables`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 800));
const href = await page.evaluate(() => {
  const prefer = [...document.querySelectorAll("a")].find(
    (el) =>
      el.textContent?.includes("产品需求看板") &&
      /\/app\/tables\//.test(el.getAttribute("href") || "")
  );
  if (prefer) return prefer.getAttribute("href");
  const a = [...document.querySelectorAll("a")].find((el) =>
    /\/app\/tables\/[^/]+$/.test(el.getAttribute("href") || "")
  );
  return a?.getAttribute("href") || null;
});
if (!href) throw new Error("no table link");
await page.goto(`${BASE}${href}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));

// breadcrumb shot
await page.screenshot({
  path: path.join(OUT, "fix-nav-breadcrumb.png"),
  fullPage: false,
});
console.log("saved fix-nav-breadcrumb.png", page.url());

const crumb = await page.$('[data-testid="table-breadcrumb"]');
console.log("breadcrumb present", !!crumb);

// open filters and add empty condition
await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="filter-toggle"]');
  if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
});
await new Promise((r) => setTimeout(r, 300));

// clear existing then add
await page.evaluate(() => {
  const clear = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("清空")
  );
  clear?.click();
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  const add = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("条件")
  );
  add?.click();
});
await new Promise((r) => setTimeout(r, 800));

// wait for rows to show (empty filter should not hide)
const status = await page.evaluate(() => {
  const el = [...document.querySelectorAll("p, span, div")].find((n) =>
    /匹配\s*\d+\s*行/.test(n.textContent || "")
  );
  return el?.textContent?.trim() || null;
});
console.log("match status:", status);

await page.screenshot({
  path: path.join(OUT, "fix-filter-empty-incomplete.png"),
  fullPage: false,
});
console.log("saved fix-filter-empty-incomplete.png");

// verify layout: value input same row as selects
const layout = await page.evaluate(() => {
  const row = document.querySelector(
    '[data-testid="filter-toggle"]'
  )?.closest("div.mb-3")?.querySelector(".flex.flex-nowrap");
  if (!row) return { ok: false, reason: "no nowrap row" };
  const inputs = row.querySelectorAll("input");
  const selects = row.querySelectorAll("button[role='combobox']");
  const rects = [...row.children].map((c) => {
    const r = c.getBoundingClientRect();
    return { tag: c.tagName, top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) };
  });
  const tops = new Set(rects.filter((r) => r.w > 20).map((r) => r.top));
  return {
    ok: tops.size <= 2, // allow 1-2px rounding; mainly one row
    tops: [...tops],
    selects: selects.length,
    inputs: inputs.length,
    rects,
  };
});
console.log("layout check", JSON.stringify(layout, null, 2));

await browser.close();
