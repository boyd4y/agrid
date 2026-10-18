import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, artifact as artifactPath } from './fixture.mjs';
const directory = artifactPath('reference-editor-files');
const f = await createBrowserFixture({ name: 'Reference toolbar and slash', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory } });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(12000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const saved = root => root.getByRole('status').filter({ hasText: '全部更改已保存' }).waitFor();
try {
  const table = await api('/tables', { name: '完整编辑器' }), title = (await api(`/tables/${table.id}`)).columns[0];
  const row = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '常驻工具与块命令' } }), identity = { tableId: table.id, rowId: row.id };
  await page.goto(frontend + `/app/tables/${table.id}`); await page.getByTestId(`open-grid-record-${row.id}`).click();
  const panel = page.getByTestId('related-record-panel'), body = panel.getByRole('textbox', { name: '正文内容', exact: true }), toolbar = panel.getByTestId('editor-toolbar');
  await body.waitFor();
  for (const name of ['撤销', '重做', '正文', '引用', '行内代码', '代码块', '加粗', '斜体', '下划线', '删除线', '链接', '无序列表', '有序列表', '分隔线', '对齐', '上传图片', '文字颜色与高亮', '搜索与替换']) assert.equal(await toolbar.getByRole('button', { name, exact: true }).count(), 1, name);
  const menu = page.getByRole('dialog', { name: '块命令', exact: true });
  const item = key => menu.locator(`[cmdk-item][data-value="${key}"]`);
  await body.fill('/'); await menu.waitFor(); assert.equal(await item('heading2').count(), 1);
  assert(await body.evaluate(el => document.activeElement === el), 'slash leaves focus in prose');
  await page.keyboard.insertText('heading 2'); await item('heading2').waitFor(); assert.equal(await menu.locator('[cmdk-item]').count(), 1);
  await page.keyboard.press('Enter'); await menu.waitFor({ state: 'hidden' });
  await page.keyboard.insertText('标题内容'); assert.equal(await body.locator('h2').innerText(), '标题内容');
  // Filter in either language; arrows wrap and Enter uses the highlighted item.
  await body.fill('/标题'); await menu.waitFor(); assert.equal(await menu.locator('[cmdk-item]').count(), 3);
  await page.keyboard.press('ArrowDown'); assert.equal(await item('heading2').getAttribute('data-selected'), 'true');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); assert.equal(await item('heading3').getAttribute('data-selected'), 'true');
  await page.keyboard.press('Enter'); await page.keyboard.insertText('三级'); assert.equal(await body.locator('h3').innerText(), '三级');
  await body.fill('/quote'); await menu.waitFor(); await item('quote').click(); assert.equal((await body.innerText()).trim(), ''); assert.equal(await body.locator('blockquote').count(), 1);
  await page.keyboard.insertText('引用保留焦点'); assert((await body.innerText()).includes('引用保留焦点'));
  await body.fill('/not-a-command'); await menu.waitFor(); await menu.getByText('没有匹配的命令').waitFor();
  await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' }); assert(await panel.isVisible()); assert.equal((await body.innerText()).trim(), '/not-a-command');
  assert(await body.evaluate(el => document.activeElement === el));
  await page.keyboard.press('ArrowLeft'); await menu.waitFor(); await page.keyboard.press('Escape');
  for (const text of ['普通 / 正文', 'https://example.com/a/b', '/usr/local', 'first/last']) { await body.fill(text); await page.waitForTimeout(50); assert.equal(await menu.count(), 0, text); assert.equal((await body.innerText()).trim(), text); }
  // IME must not run a command on its confirmation Enter or consume the composing text.
  await body.fill('/'); await menu.waitFor();
  const headingCount = await body.locator('h1,h2,h3').count();
  const cdp = await f.ctx.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '标题', selectionStart: 2, selectionEnd: 2 });
  await menu.waitFor({ state: 'hidden' }); await page.keyboard.press('Enter');
  await cdp.send('Input.insertText', { text: '标题' });
  assert((await body.innerText()).includes('标题')); assert.equal(await body.locator('h1,h2,h3').count(), headingCount);
  await cdp.detach();
  // Apply toolbar marks to the real selection, then round-trip through the actual command endpoint.
  await body.fill('颜色高亮下划线'); await page.keyboard.press('Meta+a');
  await toolbar.getByRole('button', { name: '下划线', exact: true }).click();
  await toolbar.getByRole('button', { name: '删除线', exact: true }).click();
  await toolbar.getByRole('button', { name: '文字颜色与高亮', exact: true }).click();
  await page.getByRole('menuitem', { name: '蓝色', exact: true }).first().click();
  await toolbar.getByRole('button', { name: '文字颜色与高亮', exact: true }).click();
  await page.getByRole('menuitem', { name: '黄色', exact: true }).last().click();
  await toolbar.getByRole('button', { name: '对齐', exact: true }).click(); await page.getByRole('menuitem', { name: '居中对齐', exact: true }).click();
  await page.keyboard.press('ArrowRight'); await saved(panel);
  let doc = await command('getDocument', identity), html = (await command('renderDocument', identity)).html;
  assert(JSON.stringify(doc.content).includes('underline')); assert(JSON.stringify(doc.content).includes('#337ea9')); assert(JSON.stringify(doc.content).includes('#fdecc8')); assert(html.includes('text-align:center')); assert(html.includes('<u>'));
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await page.getByTestId(`open-grid-record-${row.id}`).click(); await body.locator('u').waitFor(); assert((await body.locator('mark').getAttribute('style')).includes('background-color'));
  // Actual browser paste parsing must strip unsupported style-only/empty textStyle spans.
  await body.fill('');
  await body.evaluate(el => {
    const data = new DataTransfer(); data.setData('text/html', '<p><span style="font-size:14px">字号文本</span> <span style="color:red">命名颜色</span> <span style="color:#337ea9">安全颜色</span> <span style="background-image:url(https://evil.test/x)">无样式</span></p>');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await saved(panel); const pasted = (await command('getDocument', identity)).content;
  assert(JSON.stringify(pasted).includes('字号文本')); assert(JSON.stringify(pasted).includes('命名颜色')); assert(JSON.stringify(pasted).includes('#337ea9'));
  assert(!JSON.stringify(pasted).includes('font-size')); assert(!JSON.stringify(pasted).includes('background-image')); assert(!JSON.stringify(pasted).includes('"color":null'));
  console.log('PASS paste span font-size, named color, safe hex and unknown style: no empty textStyle or autosave failure');
  // Literal search, next/previous and replace-all across separate formatting spans.
  await body.fill('Find find Find');
  await body.evaluate(el => {
    el.focus(); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while (node = walker.nextNode()) if (node.textContent.includes('Find')) { const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 4); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); break; }
  });
  await page.waitForFunction(() => getSelection()?.toString() === 'Find');
  await toolbar.getByRole('button', { name: '加粗', exact: true }).click(); await page.keyboard.press('ArrowRight');
  await toolbar.getByRole('button', { name: '搜索与替换', exact: true }).click();
  const search = page.getByRole('dialog', { name: '搜索与替换', exact: true }); await search.getByLabel('搜索', { exact: true }).fill('find');
  await search.getByText('1/3', { exact: true }).waitFor(); await search.getByRole('button', { name: '下一个匹配', exact: true }).click(); await search.getByText('2/3', { exact: true }).waitFor();
  await search.getByRole('button', { name: '上一个匹配', exact: true }).click(); await search.getByLabel('区分大小写', { exact: true }).check(); await search.getByText('1/1', { exact: true }).waitFor();
  await search.getByLabel('区分大小写', { exact: true }).uncheck(); await search.getByLabel('替换为', { exact: true }).fill('Done'); await search.getByRole('button', { name: '替换', exact: true }).click(); assert.equal((await body.innerText()).trim(), 'Done find Find');
  await search.getByRole('button', { name: '全部替换', exact: true }).click();
  assert.equal((await body.innerText()).trim(), 'Done Done Done'); await page.keyboard.press('Escape'); await search.waitFor({ state: 'hidden' });
  assert(await toolbar.getByRole('button', { name: '搜索与替换', exact: true }).evaluate(el => el === document.activeElement), 'Escape returns search trigger');
  await toolbar.getByRole('button', { name: '撤销', exact: true }).click(); assert.equal((await body.innerText()).trim(), 'Done find Find'); await toolbar.getByRole('button', { name: '重做', exact: true }).click(); assert.equal((await body.innerText()).trim(), 'Done Done Done');
  // Private-image command uses the application's existing picker, draining the removed prefix before upload.
  await body.fill('/image'); await menu.waitFor(); await item('image').waitFor();
  const picker = page.waitForEvent('filechooser'); await item('image').click(); const chooser = await picker;
  await chooser.setFiles({ name: 'slash.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQIHWP4DwABAQEAG7buVgAAAABJRU5ErkJggg==', 'base64') });
  await body.locator('img').waitFor(); await saved(panel); doc = await command('getDocument', identity);
  const image = doc.content.content.find(n => n.type === 'image'); assert.match(image.attrs.fileId, /^[0-9a-f-]{36}$/); assert(!JSON.stringify(doc.content).includes('/image')); assert(!JSON.stringify(doc.content).includes('data:image'));
  // Responsive menus stay in bounds at the actual caret, inside the record dialog.
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 }); await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await body.fill('reset'); await body.fill('/'); await menu.waitFor(); const box = await menu.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1); assert(box.y >= 0 && box.y + box.height <= (width < 500 ? 844 : 1000) + 1);
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    assert((await toolbar.boundingBox()).height < 50, 'single-line toolbar');
    await page.screenshot({ path: artifact(`reference-record-${width}-${theme}.png`) }); await page.keyboard.press('Escape');
  }
  // Keyboard focus scrolls the last control into the toolbar viewport without page overflow.
  await toolbar.getByRole('button', { name: '搜索与替换', exact: true }).focus();
  const viewport = toolbar.locator('[data-slot="scroll-area-viewport"]');
  assert(await viewport.evaluate(el => el.scrollLeft > 0));
  const vp = await viewport.boundingBox(), searchBounds = await toolbar.getByRole('button', { name: '搜索与替换', exact: true }).boundingBox();
  assert(searchBounds.x >= vp.x - 1 && searchBounds.x + searchBounds.width <= vp.x + vp.width + 1);
  await body.fill('直接关闭保存'); await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' }); assert(JSON.stringify((await command('getDocument', identity)).content).includes('直接关闭保存'));
  assert.deepEqual(f.errors, []);
  console.log('PASS reference editor: complete persistent toolbar; slash filters, keyboard/mouse/Escape, ordinary slashes, real IME; retained selection; persistent safe formats; search/replace and session undo; private image; close flush; desktop/390/320 light-dark.');
} catch (error) { console.error(f.errors); console.error(await page.locator('.tiptap').evaluate(el => JSON.stringify({ selection: el.editor.state.selection.toJSON(), content: el.editor.getJSON(), canBold: el.editor.can().toggleBold() })).catch(()=>null)); console.error(await page.locator('[data-testid="document-editor"]').innerText().catch(() => '')); await page.screenshot({ path: artifact('reference-failure.png') }).catch(() => {}); throw error; }
finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
