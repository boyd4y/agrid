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
  for (const [story, width] of [['mobile-320', 320], ['mobile-390', 390], ['record-width', 1000], ['wide-desktop', 1120], ['sidebar-narrow', 160]]) for (const theme of ['light', 'dark']) {
    await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--${story}&viewMode=story&globals=theme:${theme}`);
    const toolbar = page.getByTestId('editor-toolbar'); await toolbar.waitFor();
    const layout = await assertToolbarFits(toolbar); assert(Math.abs(layout.width - width) < 1, 'story reproduces exact content width');
    const rows = new Set(layout.buttons.map(button => button.y));
    if (width >= 960) assert.equal(rows.size, 1, 'wide toolbar is a complete single row');
    else assert(rows.size >= 2 && rows.size <= (width === 160 ? 4 : 3), 'narrow toolbar uses a few grouped rows');
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
    if (width < 960) {
      await toolbar.getByRole('button', { name: chinese ? '插入' : 'Insert', exact: true }).click();
      await page.getByRole('menuitem', { name: chinese ? '图片' : 'Image', exact: true }).click();
    } else await toolbar.getByRole('button', { name: chinese ? '图片' : 'Image', exact: true }).click(); await page.getByText(chinese ? '已调用图片回调，由应用提供私有上传流程。' : 'Image callback called. The application supplies the private upload flow.', { exact: true }).waitFor();
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--english&viewMode=story`);
    const toolbar = page.getByTestId('editor-toolbar'); await toolbar.waitFor(); await assertToolbarFits(toolbar);
    const body = page.locator('[contenteditable="true"]');
    await body.fill('Selected text'); await body.press('Meta+a');
    await page.getByTestId('selection-formatting').waitFor();
    await toolbar.getByRole('button', { name: 'Underline', exact: true }).click(); assert.equal(await body.locator('u').innerText(), 'Selected text');
    await toolbar.getByRole('button', { name: 'Styles', exact: true }).click();
    await page.getByRole('button', { name: 'Text color & highlight', exact: true }).click(); await page.getByRole('menuitem', { name: 'Blue', exact: true }).first().click();
    await page.keyboard.press('Escape');
    await toolbar.getByRole('button', { name: 'Structure', exact: true }).press('Enter'); await page.getByRole('menu').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent === 'Structure');
    assert(await toolbar.getByRole('button', { name: 'Structure', exact: true }).evaluate(el => el === document.activeElement));
    await body.fill('/heading 2'); await page.getByRole('dialog', { name: 'Block commands', exact: true }).waitFor(); await body.press('Enter'); await page.keyboard.insertText('Heading'); assert.equal(await body.locator('h2').innerText(), 'Heading');
    await assertToolbarFits(toolbar);
    await toolbar.getByRole('button', { name: 'Search and replace', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Search and replace', exact: true }); await search.waitFor();
    const box = await search.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1);
    await page.keyboard.press('Escape'); await search.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search and replace'); assert(await toolbar.getByRole('button', { name: 'Search and replace', exact: true }).evaluate(el => el === document.activeElement));
  }
  // Execute every grouped command in both languages, including the 160px sidebar container.
  for (const [story, zh] of [['sidebar-narrow', true], ['mobile-390', false]]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--${story}&viewMode=story`);
    const toolbar = page.getByTestId('editor-toolbar'), body = page.locator('[contenteditable="true"]'); await toolbar.waitFor();
    const structure = toolbar.getByRole('button', { name: zh ? '结构' : 'Structure', exact: true });
    const paragraph = zh ? '正文' : 'Text';
    const block = async name => { await structure.click(); await page.getByRole('menuitem', { name, exact: true }).click(); };
    const reset = async () => { await block(paragraph); await body.fill('Command selection'); await body.press('Meta+a'); };
    for (const [name, selector] of [[paragraph, 'p'], [zh ? '标题 1' : 'Heading 1', 'h1'], [zh ? '标题 2' : 'Heading 2', 'h2'], [zh ? '标题 3' : 'Heading 3', 'h3'], [zh ? '无序列表' : 'Bullet list', 'ul'], [zh ? '有序列表' : 'Numbered list', 'ol'], [zh ? '引用' : 'Quote', 'blockquote'], [zh ? '代码块' : 'Code block', 'pre']]) {
      await reset(); await block(name); assert.equal(await body.locator(selector).innerText(), 'Command selection', name);
      await page.waitForFunction(() => document.activeElement?.getAttribute('contenteditable') === 'true');
      assert(await body.evaluate(el => el === document.activeElement), 'grouped command returns focus to prose');
    }
    for (const [name, selector] of [[zh ? '加粗' : 'Bold', 'strong'], [zh ? '斜体' : 'Italic', 'em'], [zh ? '下划线' : 'Underline', 'u']]) {
      await reset(); await toolbar.getByRole('button', { name, exact: true }).click(); assert.equal(await body.locator(selector).innerText(), 'Command selection');
    }
    await reset(); await toolbar.getByRole('button', { name: zh ? '链接' : 'Link', exact: true }).click();
    const link = page.getByRole('dialog', { name: zh ? '链接' : 'Link', exact: true });
    await link.getByLabel(zh ? '链接地址' : 'URL', { exact: true }).fill('https://example.com/retained'); await link.getByRole('button', { name: zh ? '应用链接' : 'Apply link', exact: true }).click();
    assert.equal(await body.locator('a').innerText(), 'Command selection');
    for (const [name, selector] of [[zh ? '删除线' : 'Strikethrough', 's'], [zh ? '行内代码' : 'Inline code', 'code']]) {
      await reset(); await toolbar.getByRole('button', { name: zh ? '样式' : 'Styles', exact: true }).click();
      const styles = page.getByRole('dialog', { name: zh ? '样式' : 'Styles', exact: true });
      await styles.getByRole('button', { name, exact: true }).click(); assert.equal(await body.locator(selector).innerText(), 'Command selection');
      if (await styles.isVisible()) await page.keyboard.press('Escape');
    }
    await reset(); await toolbar.getByRole('button', { name: zh ? '插入' : 'Insert', exact: true }).click(); await page.getByRole('menuitem', { name: zh ? '分隔线' : 'Horizontal rule', exact: true }).click(); await body.locator('hr').waitFor();
    await toolbar.getByRole('button', { name: zh ? '撤销' : 'Undo', exact: true }).click(); assert.equal(await body.locator('hr').count(), 0);
    await toolbar.getByRole('button', { name: zh ? '重做' : 'Redo', exact: true }).click(); await body.locator('hr').waitFor();
    for (const [label, item, selector] of [[zh ? '对齐' : 'Alignment', zh ? '居中对齐' : 'Align center', '[style*="text-align: center"]'], [zh ? '文字颜色与高亮' : 'Text color & highlight', zh ? '蓝色' : 'Blue', '[style*="color:"]']]) {
      await reset(); await toolbar.getByRole('button', { name: zh ? '样式' : 'Styles', exact: true }).click();
      const styles = page.getByRole('dialog', { name: zh ? '样式' : 'Styles', exact: true });
      await styles.getByRole('button', { name: label, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).first().click(); await body.locator(selector).waitFor();
      if (await styles.isVisible()) await page.keyboard.press('Escape');
    }
    await toolbar.getByRole('button', { name: zh ? '样式' : 'Styles', exact: true }).click();
    const styles = page.getByRole('dialog', { name: zh ? '样式' : 'Styles', exact: true });
    await styles.getByRole('button', { name: zh ? '文字颜色与高亮' : 'Text color & highlight', exact: true }).click(); await page.getByRole('menuitem', { name: zh ? '黄色' : 'Yellow', exact: true }).last().click(); await body.locator('mark').waitFor();
    if (await styles.isVisible()) await page.keyboard.press('Escape'); await assertToolbarFits(toolbar);
  }
  // Resize the container with each portal open; the old layout must unmount its portal.
  await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--english&viewMode=story`);
  const responsive = page.getByTestId('editor-toolbar'); await responsive.waitFor();
  const resize = async width => {
    await responsive.evaluate((el, width) => { el.closest('[data-rich-text-editor]').parentElement.style.maxWidth = `${width}px`; }, width);
    await responsive.locator(`[data-toolbar-layout="${width >= 960 ? 'full' : 'grouped'}"]`).waitFor();
  };
  for (const [width, trigger, nested] of [[1000, 'Search and replace'], [1000, 'Text'], [390, 'Structure'], [390, 'Styles'], [390, 'Styles', 'Text color & highlight']]) {
    await resize(width); await responsive.getByRole('button', { name: trigger, exact: true }).click();
    if (nested) await page.getByRole('dialog', { name: trigger, exact: true }).getByRole('button', { name: nested, exact: true }).click();
    await resize(width >= 960 ? 390 : 1000);
    await page.waitForFunction(() => !document.querySelector('[role="menu"], [role="dialog"]'));
    await page.waitForFunction(() => document.activeElement?.getAttribute('contenteditable') === 'true');
    assert.equal(await page.getByRole('menu').count(), 0); assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await responsive.locator('[data-toolbar-layout]').count(), 1, 'only one toolbar layout mounts');
  }
  await page.goto(`${origin}/iframe.html?id=ui-richtexteditor--disabled&viewMode=story`); await page.getByTestId('editor-toolbar').waitFor();
  assert(await page.getByTestId('editor-toolbar').getByRole('button', { name: 'Underline', exact: true }).isDisabled());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(layouts, null, 2));
  console.log('PASS Storybook index/sidebar; exact 160/320/390/1000/1120 light/dark layout; all targets/internal groups fit; search/more/image; viewport 320/390 selection/color/heading/slash/focus; disabled; all grouped commands in Chinese/English at 160/390; open search/heading/structure/styles/nested-color resize across 960 closes portals and restores visible focus');
} finally { await browser.close(); }
