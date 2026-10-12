import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:5173";
const TABLE_ID = "0e697f4f-3b6b-4798-8ea6-7d1adf3d8a13";
const FORM_VIEW_ID = "ce82db32-2f77-4c97-987e-84172f7e9d21";

const chrome =
  ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(
    (p) => {
      try {
        return require("node:fs").existsSync(p);
      } catch {
        return false;
      }
    },
  ) || "/usr/bin/google-chrome";

import fs from "node:fs";
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
await new Promise((r) => setTimeout(r, 600));

await page.goto(`${BASE}/app/tables/${TABLE_ID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector('[data-testid="view-switcher"]', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({
  path: path.join(__dirname, "typeform-v2-grid-ondemand.png"),
  fullPage: false,
});
console.log("saved typeform-v2-grid-ondemand.png");

// Click form view by id
const formBtn = await page.$(`[data-view-id="${FORM_VIEW_ID}"]`);
if (!formBtn) {
  // fallback: click any form view
  await page.click('[data-testid="view-form"]');
} else {
  await formBtn.click();
}
await page.waitForSelector('[data-testid="form-designer"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="table-form"]', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({
  path: path.join(__dirname, "typeform-v2-designer.png"),
  fullPage: false,
});
console.log("saved typeform-v2-designer.png");

// Switch to fill mode
const fillBtn = await page.evaluateHandle(() => {
  const buttons = [...document.querySelectorAll("button")];
  return buttons.find((b) => b.textContent?.includes("填写")) || null;
});
if (fillBtn.asElement()) {
  await fillBtn.asElement().click();
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({
    path: path.join(__dirname, "typeform-v2-fill-focus.png"),
    fullPage: false,
  });
  console.log("saved typeform-v2-fill-focus.png");
}

// Theme popover in design mode
const designBtn = await page.evaluateHandle(() => {
  const buttons = [...document.querySelectorAll("button")];
  return buttons.find((b) => b.textContent?.includes("设计")) || null;
});
if (designBtn.asElement()) await designBtn.asElement().click();
await new Promise((r) => setTimeout(r, 400));
const themeBtn = await page.evaluateHandle(() => {
  const buttons = [...document.querySelectorAll("button")];
  return buttons.find((b) => b.textContent?.includes("主题")) || null;
});
if (themeBtn.asElement()) {
  await themeBtn.asElement().click();
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(__dirname, "typeform-v2-themes.png"),
    fullPage: false,
  });
  console.log("saved typeform-v2-themes.png");
}

if (pageErrors.length) {
  console.log("pageErrors:", pageErrors.slice(0, 8));
} else {
  console.log("no page errors");
}
await browser.close();
