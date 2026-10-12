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
await new Promise((r) => setTimeout(r, 1000));

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="chat-harness-badge"]', {
  timeout: 15000,
});
await new Promise((r) => setTimeout(r, 1200));

const closed = await page.evaluate(() => {
  const root = document.querySelector('[data-testid="workspace-home-split"]');
  const badge = document.querySelector('[data-testid="chat-harness-badge"]');
  const trigger = document.querySelector(
    '[data-testid="chat-panel"] button[data-slot="model-selector-trigger"], [data-testid="chat-panel"] button[role="combobox"]',
  );
  const header = badge?.parentElement;
  const headerStyle = header ? getComputedStyle(header) : null;
  return {
    previewOpen: root?.getAttribute("data-preview-open"),
    hasSlot: !!document.querySelector('[data-testid="workspace-preview-slot"]'),
    hasExpand: !!document.querySelector(
      '[data-testid="workspace-preview-expand"]',
    ),
    hasFullView: Array.from(document.querySelectorAll("a,button")).some((el) =>
      (el.textContent || "").includes("完整视图"),
    ),
    hasBadge: !!badge,
    hasSelector: !!trigger,
    justifyContent: headerStyle?.justifyContent ?? null,
    badgeRight: badge
      ? Math.round(badge.getBoundingClientRect().right)
      : null,
    selectorLeft: trigger
      ? Math.round(trigger.getBoundingClientRect().left)
      : null,
    headerWidth: header
      ? Math.round(header.getBoundingClientRect().width)
      : null,
  };
});
console.log("closed", JSON.stringify(closed, null, 2));

await page.screenshot({
  path: path.join(OUT, "preview-default-closed-header.png"),
});

// Open via tool bridge event (same path open_preview tool uses)
await page.evaluate(() => {
  window.dispatchEvent(
    new CustomEvent("agrid:open-preview", {
      detail: { open: true, kind: "table" },
    }),
  );
});
await page.waitForSelector('[data-testid="workspace-preview-slot"]', {
  timeout: 10000,
});
await new Promise((r) => setTimeout(r, 1500));

const open = await page.evaluate(() => {
  const root = document.querySelector('[data-testid="workspace-home-split"]');
  const slot = document.querySelector('[data-testid="workspace-preview-slot"]');
  const panel = document.querySelector('[data-panel-id="workspace-preview"]')
    || document.querySelector('#workspace-preview')
    || slot?.parentElement;
  const rootRect = root?.getBoundingClientRect();
  const slotRect = slot?.getBoundingClientRect();
  return {
    previewOpen: root?.getAttribute("data-preview-open"),
    hasSlot: !!slot,
    hasFullView: Array.from(document.querySelectorAll("a,button")).some((el) =>
      (el.textContent || "").includes("完整视图"),
    ),
    rootH: rootRect ? Math.round(rootRect.height) : null,
    slotH: slotRect ? Math.round(slotRect.height) : null,
    slotTop: slotRect ? Math.round(slotRect.top) : null,
    rootTop: rootRect ? Math.round(rootRect.top) : null,
    slotFillRatio:
      rootRect && slotRect
        ? Number((slotRect.height / rootRect.height).toFixed(3))
        : null,
  };
});
console.log("open", JSON.stringify(open, null, 2));

await page.screenshot({
  path: path.join(OUT, "preview-tool-open-fullheight.png"),
});

const errors = [];
if (closed.previewOpen !== "false") errors.push("default should be closed");
if (closed.hasSlot) errors.push("slot should not render when closed");
if (closed.hasExpand) errors.push("manual 预览 expand should be gone");
if (closed.hasFullView || open.hasFullView) errors.push("完整视图 still present");
if (!closed.hasBadge || !closed.hasSelector)
  errors.push("agent selector / harness badge missing");
if (closed.justifyContent !== "space-between")
  errors.push(`header justify=${closed.justifyContent}, want space-between`);
if (open.previewOpen !== "true" || !open.hasSlot)
  errors.push("tool open failed");
if (open.slotFillRatio != null && open.slotFillRatio < 0.9)
  errors.push(`preview height ratio ${open.slotFillRatio} < 0.9`);

if (errors.length) {
  console.error("FAIL", errors);
  await browser.close();
  process.exit(1);
}

console.log("PASS");
await browser.close();
