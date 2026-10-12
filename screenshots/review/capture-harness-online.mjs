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
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
  await page.evaluate(() => {
    const email =
      document.querySelector('input[type="email"]') ||
      document.querySelector('input[name="email"]');
    const pass =
      document.querySelector('input[type="password"]') ||
      document.querySelector('input[name="password"]');
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    set.call(email, "demo@agrid.app");
    email.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(pass, "Demo1234!");
    pass.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
}

await login();

// Agents create form — open harness dropdown
await page.goto(`${BASE}/app/agents`, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector('[data-testid="agents-page"]', { timeout: 20000 });
// click create tab / button
const createBtn = await page.$('button:has-text("创建智能体"), button:has-text("新建配置")').catch(() => null);
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  const b =
    buttons.find((x) => x.textContent?.includes("新建配置")) ||
    buttons.find((x) => x.textContent?.includes("创建智能体"));
  b?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.waitForSelector('[data-testid="agent-create-form"]', { timeout: 10000 });

// Open harness select
await page.evaluate(() => {
  const form = document.querySelector('[data-testid="agent-create-form"]');
  const triggers = [...(form?.querySelectorAll('[data-slot="select-trigger"], button[role="combobox"]') || [])];
  // first combobox is Harness
  triggers[0]?.click();
});
await new Promise((r) => setTimeout(r, 800));

await page.screenshot({
  path: path.join(OUT, "pi-openrouter-online-agents.png"),
  fullPage: false,
});
console.log("saved pi-openrouter-online-agents.png");

// Also capture chat on workspace home
await page.keyboard.press("Escape");
await page.goto(`${BASE}/app`, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 20000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1000));

// open harness select in chat
await page.evaluate(() => {
  const panel = document.querySelector('[data-testid="chat-panel"]');
  const trigger = panel?.querySelector('[data-slot="select-trigger"], button[role="combobox"]');
  trigger?.click();
});
await new Promise((r) => setTimeout(r, 800));

await page.screenshot({
  path: path.join(OUT, "pi-openrouter-online-chat.png"),
  fullPage: false,
});
console.log("saved pi-openrouter-online-chat.png");

// Verify status from page context
const status = await page.evaluate(async () => {
  const r = await fetch("/api/chat/status");
  return r.json();
});
console.log(JSON.stringify({ mode: status.mode, harnesses: status.harnesses.map(h => ({ id: h.id, available: h.available, defaultModel: h.defaultModel, label: h.label })) }, null, 2));

await browser.close();
