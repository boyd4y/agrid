import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:5173";
const TABLE_ID = "0e697f4f-3b6b-4798-8ea6-7d1adf3d8a13";
const VIEW_ID = "ce82db32-2f77-4c97-987e-84172f7e9d21";

const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.clear());
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

// Table detail → Form tab
await page.goto(`${BASE}/app/tables/${TABLE_ID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector('[data-testid="view-form"]', { timeout: 20000 });
await page.click('[data-testid="view-form"]');
await page.waitForSelector('[data-testid="table-form"]', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({
  path: path.join(__dirname, "form-view-tab.png"),
  fullPage: false,
});
console.log("saved form-view-tab.png");

// Open form preview via event
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
await page.evaluate(
  ({ tableId, viewId }) => {
    window.dispatchEvent(
      new CustomEvent("agrid:open-preview", {
        detail: { open: true, kind: "form", tableId, viewId },
      }),
    );
  },
  { tableId: TABLE_ID, viewId: VIEW_ID },
);
await page.waitForSelector('[data-testid="preview-slot-form"]', {
  timeout: 20000,
});
await page.waitForSelector('[data-testid="table-form"]', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({
  path: path.join(__dirname, "form-preview-slot.png"),
  fullPage: false,
});
console.log("saved form-preview-slot.png");

const info = await page.evaluate(() => ({
  previewOpen: document
    .querySelector('[data-testid="workspace-home-split"]')
    ?.getAttribute("data-preview-open"),
  formTitle: document.querySelector('[data-testid="table-form"] h2')?.textContent,
  fieldCount: document.querySelectorAll(
    '[data-testid="table-form"] [data-slot="form-item"]',
  ).length,
}));
console.log("info", info);
if (pageErrors.length) console.log("pageErrors", pageErrors.slice(0, 5));

await browser.close();
