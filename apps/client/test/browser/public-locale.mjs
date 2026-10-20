import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Public pages only need an anonymous session; no API process or database is used.
const frontend = process.env.BROWSER_BASE_URL ?? 'http://localhost:5173';
const artifactDir = process.env.BROWSER_ARTIFACT_DIR ?? fileURLToPath(new URL('../artifacts/public-locale/', import.meta.url));
await mkdir(artifactDir, { recursive: true });
const copy = {};
for (const locale of ['zh-CN', 'en']) {
  copy[locale] = {};
  for (const namespace of ['common', 'marketing', 'app', 'docs']) {
    copy[locale][namespace] = JSON.parse(await readFile(new URL(`../../src/i18n/locales/${locale}/${namespace}.json`, import.meta.url), 'utf8'));
  }
}
const launchOptions = process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : process.env.BROWSER_CHANNEL === 'bundled' ? {} : { channel: process.env.BROWSER_CHANNEL ?? 'chrome' };
const browser = await chromium.launch({ headless: true, ...launchOptions });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
context.setDefaultTimeout(15_000);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/**', route => {
  assert.equal(new URL(route.request().url()).pathname, '/api/auth/get-session', 'only the public session lookup is expected');
  return route.fulfill({ json: null });
});
const header = page.getByRole('banner');
const label = locale => copy[locale].common[locale === 'en' ? 'languageEn' : 'languageZh'];
const languageName = locale => copy[locale].common.languageCurrent.replace('{{label}}', label(locale));
const trigger = locale => header.getByRole('button', { name: languageName(locale), exact: true });
const history = () => page.evaluate(() => ({ url: location.href, length: window.history.length, state: window.history.state, marker: window.localeTestMarker }));

async function assertLocale(locale, article = false) {
  await trigger(locale).waitFor();
  await header.getByRole('img', { name: 'tabdo', exact: true }).waitFor();
  assert.equal(await trigger(locale).innerText(), label(locale));
  assert.equal(await page.locator('html').getAttribute('lang'), locale);
  assert.equal(await page.evaluate(() => localStorage.getItem('tabdo.locale')), locale);
  for (const [key, path] of [['home', '/'], ['docs', '/docs'], ['blog', '/blog']]) {
    assert.equal(await header.getByRole('link', { name: copy[locale].marketing.nav[key], exact: true }).getAttribute('href'), path);
  }
  await page.getByRole('heading', { level: 1, name: article ? (locale === 'en' ? 'Welcome' : '欢迎') : copy[locale].marketing.brand.slogan, exact: true }).waitFor();
  if (article) {
    assert((await page.locator('article').innerText()).includes(locale === 'en' ? 'Bring tabdo the information you want to organize' : '把想整理的资料、计划中的旅行'));
    await page.getByRole('complementary').getByRole('link', { name: locale === 'en' ? 'How it works' : '工作原理', exact: true }).waitFor();
  } else {
    assert((await page.getByRole('main').innerText()).includes(copy[locale].marketing.brand.description));
  }
  await header.getByRole('link', { name: copy[locale].marketing.login, exact: true }).waitFor();
  await header.getByRole('link', { name: copy[locale].marketing.signup, exact: true }).waitFor();
}

async function switchLocale(from, to, keyboard = false) {
  const before = await history();
  if (keyboard) {
    await trigger(from).focus();
    await page.keyboard.press('Enter');
  } else {
    await trigger(from).click();
  }
  const selected = page.getByRole('menuitemradio', { name: label(from), exact: true });
  await selected.waitFor();
  assert.equal(await selected.getAttribute('aria-checked'), 'true');
  assert.equal(await selected.locator('svg').count(), 1, 'selected language has a visible check mark');
  if (keyboard) {
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitemradio');
    await page.keyboard.press(to === 'en' ? 'End' : 'Home');
    await page.waitForFunction(label => document.activeElement?.textContent === label, label(to));
    await page.keyboard.press('Enter');
  } else {
    await page.getByRole('menuitemradio', { name: label(to), exact: true }).click();
  }
  await trigger(to).waitFor();
  assert.deepEqual(await history(), before, 'locale switching preserves route, query, hash, history entry and document');
}

async function assertHeaderFits() {
  const boxes = await header.locator('a, button').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { text: element.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  const { width } = page.viewportSize();
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    assert(box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= 56, JSON.stringify(box));
    if (index) assert(box.left >= boxes[index - 1].right, 'header controls do not overlap');
  }
  assert.equal(await header.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

try {
  for (const article of [false, true]) {
    const path = article ? '/docs/welcome?source=locale-test#keep-position' : '/?source=locale-test#keep-position';
    await page.goto(frontend + path);
    await page.evaluate(() => { window.localeTestMarker = 'same-document'; });
    const initial = await page.locator('html').getAttribute('lang');
    if (initial === 'en') await switchLocale('en', 'zh-CN');
    await assertLocale('zh-CN', article);
    await switchLocale('zh-CN', 'en', true);
    await assertLocale('en', article);
    await switchLocale('en', 'zh-CN');
    await assertLocale('zh-CN', article);
    await page.reload();
    await assertLocale('zh-CN', article);
    await switchLocale('zh-CN', 'en');
    const url = page.url();
    await page.reload();
    await assertLocale('en', article);
    assert.equal(page.url(), url);

    for (const width of [1440, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        const themeTrigger = header.getByRole('button', { name: new RegExp('^' + copy.en.app.shell.themeCurrent.split('{{label}}')[0]) });
        await themeTrigger.click();
        await page.getByRole('menuitemradio', { name: copy.en.app.theme[theme], exact: true }).click();
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && localStorage.getItem('table-theme') === theme, theme);
        await assertHeaderFits();
        await trigger('en').click();
        assert.equal(await page.getByRole('menuitemradio', { name: 'English', exact: true }).getAttribute('aria-checked'), 'true');
        await page.screenshot({ path: join(artifactDir, `${article ? 'docs' : 'home'}-${width}-${theme}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, languageName('en'));
        assert.equal(await trigger('en').evaluate(element => element === document.activeElement), true, 'Escape restores focus');
        await switchLocale('en', 'zh-CN', true);
        await assertHeaderFits();
        await switchLocale('zh-CN', 'en');
      }
    }
  }

  // Client navigation and browser Back retain the same preference and entry.
  const articleUrl = page.url();
  await header.getByRole('link', { name: 'Home', exact: true }).click();
  await assertLocale('en');
  await page.goBack();
  assert.equal(page.url(), articleUrl);
  await assertLocale('en', true);
  await header.getByRole('link', { name: 'Docs', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: copy.en.docs.welcome, exact: true }).waitFor();
  await trigger('en').waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS public locale: homepage/docs, both languages, keyboard/selection/focus, route/history, reload/navigation, theme and 1440/1100 layouts. Screenshots: ${artifactDir}`);
} finally {
  await browser.close();
}
