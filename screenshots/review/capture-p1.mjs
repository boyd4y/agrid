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

async function shot(name, url, after) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  if (after) await after(page);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  console.log("saved", name);
}

async function typeVisibleSearch(text) {
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll('[data-testid="docs-search"]')];
    return nodes.some((n) => n.offsetParent !== null);
  }, { timeout: 15000 });
  await page.evaluate((t) => {
    const nodes = [...document.querySelectorAll('[data-testid="docs-search"]')];
    const el = nodes.find((n) => n.offsetParent !== null);
    if (!el) throw new Error("no visible docs-search");
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const native = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    native.call(el, t);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await new Promise((r) => setTimeout(r, 500));
}

await shot("p1-01-home.png", `${BASE}/`);

await shot("p1-02-docs-search.png", `${BASE}/docs`, async () => {
  await typeVisibleSearch("MCP");
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
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
await page.waitForFunction(
  () => location.pathname.startsWith("/app"),
  { timeout: 20000 }
).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(OUT, "p1-09-app-after-login.png") });
console.log("saved p1-09-app-after-login.png", page.url());

await shot("p1-10-app-tables.png", `${BASE}/app/tables`);

await page.goto(`${BASE}/app/tables`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1000));
const href = await page.evaluate(() => {
  const a = [...document.querySelectorAll("a")].find((el) =>
    /\/app\/tables\/[^/]+$/.test(el.getAttribute("href") || "")
  );
  return a?.getAttribute("href") || null;
});
console.log("table href", href);
if (href) {
  // Prefer 产品需求看板 if listed by text
  const prefer = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find(
      (el) =>
        el.textContent?.includes("产品需求看板") &&
        /\/app\/tables\//.test(el.getAttribute("href") || "")
    );
    return a?.getAttribute("href") || null;
  });
  await page.goto(`${BASE}${prefer || href}`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({
    path: path.join(OUT, "p1-11-table-filters-collapsed.png"),
  });
  console.log("saved p1-11-table-filters-collapsed.png");
  const toggled = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="filter-toggle"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (toggled) {
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({
      path: path.join(OUT, "p1-11b-filters-expanded.png"),
    });
    console.log("saved p1-11b-filters-expanded.png");
  } else {
    console.log("no filter toggle");
  }
}

await shot("p1-13-members-empty.png", `${BASE}/app/members`);

await browser.close();
console.log("done");
