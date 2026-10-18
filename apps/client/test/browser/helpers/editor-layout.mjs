import assert from 'node:assert/strict';

export async function assertToolbarFits(toolbar) {
  const layout = await toolbar.evaluate(root => {
    const bounds = root.getBoundingClientRect();
    const buttons = [...root.querySelectorAll('button')].map(el => {
      const rect = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') ?? el.textContent, x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    return { x: bounds.x, right: bounds.right, y: bounds.y, bottom: bounds.bottom, width: bounds.width, height: bounds.height, buttons,
      overflow: [root, ...root.querySelectorAll('*')].filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.outerHTML.slice(0, 200)),
      scrollers: root.querySelectorAll('[data-slot="scroll-area-viewport"], [data-slot="scroll-area-scrollbar"]').length };
  });
  assert.equal(layout.scrollers, 0, 'toolbar has no internal horizontal scrolling surface');
  assert.deepEqual(layout.overflow, [], 'no toolbar group or button overflows internally');
  assert(layout.buttons.length >= 18, 'all existing editing actions remain present');
  for (const button of layout.buttons) {
    assert(button.x >= layout.x - 1 && button.right <= layout.right + 1 && button.y >= layout.y && button.bottom <= layout.bottom, `${button.name} fully inside toolbar: ${JSON.stringify({ button, layout })}`);
    assert(button.width >= 32 && button.height >= 32, `${button.name} keeps its click target`);
  }
  return layout;
}

export async function assertOrdinaryEditorActions(root) {
  assert.equal(await root.getByRole('button', { name: /正文更多操作|More body actions/ }).count(), 0, 'single refresh action needs no more menu');
  assert.equal(await root.getByText(/导入|导出|容量|JSON|64 KiB|Import|Export|Writing help|4,000 nodes/).count(), 0, 'ordinary editor has no export or capacity help');
  await root.getByRole('button', { name: /^(刷新记录|Refresh record)$/ }).waitFor();
}
