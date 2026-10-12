import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:5173";
const exe = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: exe,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

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

await page.goto(`${BASE}/app/automations`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="automations-hub"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="app-sidebar"]', { timeout: 10000 });
await new Promise((r) => setTimeout(r, 700));

const out = path.join(__dirname, "automations-sidebar-hub.png");
await page.screenshot({ path: out, fullPage: false });
console.log("wrote", out);

// also open first table automations if present
const link = await page.$('[data-testid^="automations-hub-"]');
if (link) {
  await link.click();
  await page.waitForSelector('[data-testid="automations-page"]', {
    timeout: 20000,
  });
  await new Promise((r) => setTimeout(r, 700));
  const out2 = path.join(__dirname, "automations-table-page.png");
  await page.screenshot({ path: out2, fullPage: false });
  console.log("wrote", out2);
}

await browser.close();
