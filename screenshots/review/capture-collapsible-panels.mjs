import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:5173";
const OUT = __dirname;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(45000);

// clear persisted prefs so screenshots start from defaults
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.removeItem("agrid.chat.threadListOpen");
  localStorage.removeItem("agrid.workspace.previewOpen");
});

await page.waitForSelector('input[type="email"], input[name="email"]');
await page.evaluate(() => {
  const email =
    document.querySelector('input[type="email"]') ||
    document.querySelector('input[name="email"]');
  const pass = document.querySelector('input[type="password"]');
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
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
await new Promise((r) => setTimeout(r, 800));

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="chat-thread-list"]', {
  timeout: 15000,
});
await page.waitForSelector('[data-testid="workspace-preview-slot"]', {
  timeout: 15000,
});
await new Promise((r) => setTimeout(r, 1200));

await page.screenshot({
  path: path.join(OUT, "collapsible-00-default-open.png"),
});

// collapse thread list
await page.click('[data-testid="chat-thread-list-toggle"]');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({
  path: path.join(OUT, "collapsible-01-threadlist-collapsed.png"),
});

const afterThread = await page.evaluate(() => {
  const list = document.querySelector('[data-testid="chat-thread-list"]');
  const stored = localStorage.getItem("agrid.chat.threadListOpen");
  return {
    collapsed: list?.getAttribute("data-collapsed"),
    width: list ? Math.round(list.getBoundingClientRect().width) : null,
    stored,
  };
});

// collapse preview
await page.click('[data-testid="workspace-preview-collapse"]');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({
  path: path.join(OUT, "collapsible-02-preview-collapsed.png"),
});

const afterPreview = await page.evaluate(() => {
  const root = document.querySelector('[data-testid="workspace-home-split"]');
  const slot = document.querySelector('[data-testid="workspace-preview-slot"]');
  const rail = document.querySelector(
    '[data-testid="workspace-preview-expand-rail"]',
  );
  const headerExpand = document.querySelector(
    '[data-testid="workspace-preview-expand"]',
  );
  return {
    previewOpen: root?.getAttribute("data-preview-open"),
    hasSlot: !!slot,
    hasRail: !!rail,
    hasHeaderExpand: !!headerExpand,
    stored: localStorage.getItem("agrid.workspace.previewOpen"),
  };
});

// re-expand both via UI (header toggle only — no far-right rail)
await page.click('[data-testid="workspace-preview-expand"]');
await new Promise((r) => setTimeout(r, 500));
await page.click('[data-testid="chat-thread-list-toggle"]');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({
  path: path.join(OUT, "collapsible-03-reexpanded.png"),
});

// reload to verify persistence (both should be open again after reexpand)
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({
  path: path.join(OUT, "collapsible-04-persisted-after-reload.png"),
});

const afterReload = await page.evaluate(() => ({
  threadStored: localStorage.getItem("agrid.chat.threadListOpen"),
  previewStored: localStorage.getItem("agrid.workspace.previewOpen"),
  threadCollapsed: document
    .querySelector('[data-testid="chat-thread-list"]')
    ?.getAttribute("data-collapsed"),
  previewOpen: document
    .querySelector('[data-testid="workspace-home-split"]')
    ?.getAttribute("data-preview-open"),
}));

console.log(
  JSON.stringify({ afterThread, afterPreview, afterReload }, null, 2),
);
await browser.close();
