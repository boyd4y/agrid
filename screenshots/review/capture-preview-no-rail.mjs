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

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("agrid.workspace.previewOpen", "true");
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
await new Promise((r) => setTimeout(r, 1000));

await page.goto(`${BASE}/app`, { waitUntil: "networkidle2" });
await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

let debug = await page.evaluate(() => ({
  path: location.pathname,
  previewOpen: document
    .querySelector('[data-testid="workspace-home-split"]')
    ?.getAttribute("data-preview-open"),
  hasSlot: !!document.querySelector('[data-testid="workspace-preview-slot"]'),
  hasCollapse: !!document.querySelector(
    '[data-testid="workspace-preview-collapse"]',
  ),
  hasRail: !!document.querySelector(
    '[data-testid="workspace-preview-expand-rail"]',
  ),
  hasHeader: !!document.querySelector(
    '[data-testid="workspace-preview-expand"]',
  ),
  stored: localStorage.getItem("agrid.workspace.previewOpen"),
  bodySnippet: document.body?.innerText?.slice(0, 400),
}));
console.log("before collapse", JSON.stringify(debug, null, 2));

if (debug.hasSlot && debug.hasCollapse) {
  await page.click('[data-testid="workspace-preview-collapse"]');
  await new Promise((r) => setTimeout(r, 500));
} else if (debug.previewOpen === "true") {
  // force via localStorage + reload
  await page.evaluate(() =>
    localStorage.setItem("agrid.workspace.previewOpen", "false"),
  );
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));
} else if (debug.previewOpen !== "false") {
  await page.evaluate(() =>
    localStorage.setItem("agrid.workspace.previewOpen", "false"),
  );
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));
}

const state = await page.evaluate(() => {
  const root = document.querySelector('[data-testid="workspace-home-split"]');
  const slot = document.querySelector('[data-testid="workspace-preview-slot"]');
  const rail = document.querySelector(
    '[data-testid="workspace-preview-expand-rail"]',
  );
  const headerBtn = document.querySelector(
    '[data-testid="workspace-preview-expand"]',
  );
  return {
    previewOpen: root?.getAttribute("data-preview-open"),
    hasSlot: !!slot,
    hasRail: !!rail,
    hasHeaderToggle: !!headerBtn,
    headerText: headerBtn?.textContent?.trim() ?? null,
  };
});

await page.screenshot({
  path: path.join(OUT, "preview-collapsed-header-only.png"),
});

console.log("after collapse", JSON.stringify(state, null, 2));
if (state.hasRail) {
  await browser.close();
  throw new Error("far-right rail still present");
}
if (!state.hasHeaderToggle) {
  await browser.close();
  throw new Error("header 预览 toggle missing");
}
if (state.previewOpen !== "false") {
  await browser.close();
  throw new Error("preview should be collapsed");
}

await browser.close();
