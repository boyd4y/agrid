import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle2" });
await page.evaluate(() => {
  const el = [...document.querySelectorAll("a")].find((a) =>
    a.textContent?.includes("登录后进入")
  );
  el?.scrollIntoView({ block: "center" });
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(OUT, "p1-01b-home-cta.png") });
const href = await page.evaluate(() => {
  const el = [...document.querySelectorAll("a")].find((a) =>
    a.textContent?.includes("登录后进入")
  );
  return el ? { text: el.textContent.trim(), href: el.getAttribute("href") } : null;
});
console.log(href);
await browser.close();
