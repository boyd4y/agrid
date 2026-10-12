import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:5173";
const OUT = path.join(__dirname, "..");

const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome-stable",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(45000);

// Bust cache for SVG mark
await page.setCacheEnabled(false);

// Marketing home
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 800));
const markSrc = await page.evaluate(() => {
  const img = document.querySelector('img[src*="agrid-mark"]');
  return img ? img.src : null;
});
console.log("marketing mark src", markSrc);
await page.screenshot({
  path: path.join(OUT, "logo-v2-marketing.png"),
  fullPage: false,
});

// Crop header/nav logo area
const header = await page.$("header, nav, a[href='/']");
if (header) {
  await header.screenshot({ path: path.join(OUT, "logo-v2-marketing-header.png") });
}

// Login → app sidebar
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
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
await new Promise((r) => setTimeout(r, 1200));
await page.goto(`${BASE}/app`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1000));

const sidebarMark = await page.evaluate(() => {
  const img = document.querySelector('img[src*="agrid-mark"]');
  return {
    src: img?.src ?? null,
    naturalWidth: img?.naturalWidth ?? 0,
    altParent: img?.closest("a,button,div")?.innerText?.slice(0, 80) ?? null,
  };
});
console.log("sidebar mark", sidebarMark);

await page.screenshot({
  path: path.join(OUT, "logo-v2-sidebar.png"),
  fullPage: false,
});

// Sidebar-only crop if possible
const aside = await page.$("aside, [data-testid='app-sidebar'], nav");
if (aside) {
  const box = await aside.boundingBox();
  if (box) {
    await page.screenshot({
      path: path.join(OUT, "logo-v2-sidebar-crop.png"),
      clip: {
        x: box.x,
        y: box.y,
        width: Math.min(box.width, 280),
        height: Math.min(box.height, 200),
      },
    });
  }
}

// Favicon check
const fav = await page.evaluate(() => {
  const icon = document.querySelector('link[rel="icon"]');
  return icon?.href ?? null;
});
console.log("favicon", fav);

await browser.close();
console.log("done →", OUT);
