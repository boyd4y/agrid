import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { assertToolbarFits } from '../browser/helpers/editor-layout.mjs';

const origin = process.env.STORYBOOK_URL;
assert(origin, 'Set STORYBOOK_URL to the task-specific Storybook server');
const artifacts = process.env.BROWSER_ARTIFACT_DIR;
assert(artifacts, 'Set BROWSER_ARTIFACT_DIR');
await mkdir(artifacts, { recursive: true });
const index = (await (await fetch(origin + '/index.json')).json()).entries;
for (const name of ['english', 'chinese', 'record-width', 'mobile-320', 'mobile-390', 'wide-desktop', 'sidebar-narrow', 'disabled', 'slash-commands']) assert(index['ui-richtexteditor--' + name], `${name} indexed`);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin + '/?path=/story/ui-richtexteditor--english');
  await page.getByRole('button', { name: 'RichTextEditor', exact: true }).waitFor();
  await page.frameLocator('#storybook-preview-iframe').getByTestId('editor-toolbar').waitFor();
  const layouts = [];
  for (const [story, width] of [['mobile-320', 320], ['mobile-390', 390], ['record-width', 720], ['wide-desktop', 1120], ['sidebar-narrow', 160]]) for (const theme of ['light', 'dark']) {
    await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--${story}&viewMode=story&globals=theme:${theme}`);
    const toolbar = page.getByTestId('editor-toolbar'); await toolbar.waitFor();
    const layout = await assertToolbarFits(toolbar); assert(Math.abs(layout.width - width) < 1, 'story reproduces exact content width');
    const rows = new Set(layout.buttons.map(button => button.y));
    if (width >= 720) assert.equal(rows.size, width === 1120 ? 1 : 2, 'desktop/default grouped wrapping');
    else if (width >= 320) assert(rows.size >= 2 && rows.size <= 4, 'narrow layout wraps logical groups');
    if (width === 720) assert(layout.buttons.filter(b => b.y === Math.max(...rows)).length >= 5, 'balanced second row includes several logical groups');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    layouts.push({ story, theme, width, height: layout.height, rows: rows.size });
    await page.screenshot({ path: `${artifacts}/storybook-${width}-${theme}.png` });
    const chinese = story === 'mobile-320' || story === 'record-width' || story === 'sidebar-narrow';
    await toolbar.getByRole('button', { name: chinese ? '搜索与替换' : 'Search and replace', exact: true }).click();
    const search = page.getByRole('dialog', { name: chinese ? '搜索与替换' : 'Search and replace', exact: true }); await search.waitFor();
    const searchBox = await search.boundingBox(); assert(searchBox.x >= 0 && searchBox.x + searchBox.width <= 1440);
    await page.keyboard.press('Escape');
    await toolbar.getByRole('button', { name: chinese ? '更多操作' : 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: chinese ? '聚焦正文' : 'Focus body', exact: true }).click();
    await toolbar.getByRole('button', { name: chinese ? '图片' : 'Image', exact: true }).click(); await page.getByText(chinese ? '已调用图片回调，由应用提供私有上传流程。' : 'Image callback called. The application supplies the private upload flow.', { exact: true }).waitFor();
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--english&viewMode=story`);
    const toolbar = page.getByTestId('editor-toolbar'); await toolbar.waitFor(); await assertToolbarFits(toolbar);
    const body = page.locator('[contenteditable="true"]');
    await body.fill('Selected text'); await body.press('Meta+a');
    await page.getByTestId('selection-formatting').waitFor();
    await toolbar.getByRole('button', { name: 'Underline', exact: true }).click(); assert.equal(await body.locator('u').innerText(), 'Selected text');
    await toolbar.getByRole('button', { name: 'Text color & highlight', exact: true }).click(); await page.getByRole('menuitem', { name: 'Blue', exact: true }).first().click();
    await toolbar.getByRole('button', { name: 'Text', exact: true }).press('Enter'); await page.getByRole('menu').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent === 'Text');
    assert(await toolbar.getByRole('button', { name: 'Text', exact: true }).evaluate(el => el === document.activeElement));
    await body.fill('/heading 2'); await page.getByRole('dialog', { name: 'Block commands', exact: true }).waitFor(); await body.press('Enter'); await page.keyboard.insertText('Heading'); assert.equal(await body.locator('h2').innerText(), 'Heading');
    await assertToolbarFits(toolbar);
    await toolbar.getByRole('button', { name: 'Search and replace', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Search and replace', exact: true }); await search.waitFor();
    const box = await search.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1);
    await page.keyboard.press('Escape'); await search.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search and replace'); assert(await toolbar.getByRole('button', { name: 'Search and replace', exact: true }).evaluate(el => el === document.activeElement));
  }
  await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--disabled&viewMode=story`); await page.getByTestId('editor-toolbar').waitFor();
  assert(await page.getByTestId('editor-toolbar').getByRole('button', { name: 'Underline', exact: true }).isDisabled());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(layouts, null, 2));
  console.log('PASS Storybook index/sidebar; exact 320/390/720/1120 light/dark layout; all targets/internal groups fit; search/more/image; viewport 320/390 selection/color/heading/slash/focus; disabled');
} finally { await browser.close(); }
