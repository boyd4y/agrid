import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:5173";

const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(45000);

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem("agrid.chat.threadListOpen", "0");
  localStorage.setItem("agrid.workspace.previewOpen", "0");
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
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));

await page.screenshot({
  path: path.join(__dirname, "collapsible-05-both-collapsed-persisted.png"),
});

const state = await page.evaluate(() => ({
  threadCollapsed: document
    .querySelector('[data-testid="chat-thread-list"]')
    ?.getAttribute("data-collapsed"),
  threadW: Math.round(
    document
      .querySelector('[data-testid="chat-thread-list"]')
      ?.getBoundingClientRect().width ?? 0,
  ),
  previewOpen: document
    .querySelector('[data-testid="workspace-home-split"]')
    ?.getAttribute("data-preview-open"),
  hasRail: !!document.querySelector(
    '[data-testid="workspace-preview-expand-rail"]',
  ),
}));
console.log(JSON.stringify(state, null, 2));
await browser.close();
