import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, postgres, databaseUrl } from './fixture.mjs';
const directory = `${process.env.BROWSER_ARTIFACT_DIR}/unified-files`;
const f = await createBrowserFixture({ name: 'Unified key access', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory, SITE_PUBLIC_ORIGIN: `http://localhost:${process.env.BROWSER_API_PORT}` } });
const { page, api, frontend, base } = f;
const db = postgres(databaseUrl);
page.setDefaultTimeout(15000);
const id = () => crypto.randomUUID();
const command = async (command, input) => (await api('/commands', { command, input })).result;
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private body' }] }] };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVQIHWP4DwABAQEAG7buVgAAAABJRU5ErkJggg==';
const call = async (secret, command, input, status = 200) => {
  const response = await fetch(base + '/api/commands', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ command, input }) });
  assert.equal(response.status, status, `${command}: ${await response.clone().text()}`);
  return status === 200 ? (await response.json()).result : null;
};
try {
  const table = await api('/tables', { name: 'Unified articles' });
  const other = await api('/tables', { name: 'Private table' });
  const workspace = (await command('getWorkspace')).workspace;
  const foreignOrg = await api('/auth/organization/create', { name: 'Foreign org', slug: `foreign-${id()}` }); f.organizations.push(foreignOrg.id);
  await api('/auth/organization/set-active', { organizationId: foreignOrg.id });
  const foreignTable = await api('/tables', { name: 'Foreign table' });
  await api('/auth/organization/set-active', { organizationId: f.organizations[0] });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const slug = await command('addColumn', { tableId: table.id, name: 'Slug', type: 'text' });
  const row = await command('addRow', { tableId: table.id, cells: { [title.id]: 'Article', [slug.id]: 'article' } });
  const scope = { tableId: table.id, rowId: row.id };
  await command('createDocument', { ...scope, content, idempotencyKey: id() });
  const image = await command('uploadDocumentImage', { ...scope, expectedVersion: 1, name: 'private.png', mimeType: 'image/png', base64: png, idempotencyKey: id() });
  const imageContent = { ...content, content: [...content.content, { type: 'image', attrs: { fileId: image.fileId, alt: 'Private' } }] };
  await command('replaceDocument', { ...scope, expectedVersion: 1, content: imageContent, idempotencyKey: id() });
  const config = { tableId: table.id, authorName: 'Author', description: '', language: 'en', mapping: { title: title.id, slug: slug.id }, articles: [{ rowId: row.id, imageIds: [image.fileId] }] };
  let blog = await command('saveBlog', { name: 'Unified blog', config, idempotencyKey: id() });
  await page.goto(frontend + '/app/settings?tab=api-keys');
  const panel = page.getByTestId('api-keys-settings'), dialog = page.getByRole('dialog');
  const label = `${workspace.name} / Unified articles`;
  await panel.getByRole('button', { name: '创建 API Key', exact: true }).click();
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('Unified read');
  await dialog.getByRole('checkbox', { name: `${label} · 读取`, exact: true }).check();
  assert.equal(await dialog.getByTestId(`table-access-${table.id}`).count(), 1);
  assert.equal(await dialog.getByRole('checkbox', { name: /正文|构建|上传图片/ }).count(), 0);
  await dialog.getByRole('button', { name: '创建 API Key', exact: true }).click();
  const secret = await dialog.getByRole('textbox', { name: 'API Key', exact: true }).inputValue();
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  assert.equal((await call(secret, 'getDocument', scope)).version, 2);
  assert.equal((await call(secret, 'getDocumentImage', { ...scope, fileId: image.fileId })).base64, png);
  await call(secret, 'getBlog', { siteId: blog.id });
  await call(secret, 'addRow', { tableId: table.id, cells: {} }, 403);
  await call(secret, 'replaceDocument', { ...scope, expectedVersion: 2, content, idempotencyKey: id() }, 403);
  await call(secret, 'getDocument', { ...scope, tableId: other.id }, 404);
  await call(secret, 'getDocument', { ...scope, tableId: foreignTable.id }, 404);
  await call(secret, 'buildBlog', { siteId: blog.id, expectedVersion: blog.version, idempotencyKey: id() }, 403);
  // A separately UI-created Create-only key must never inherit Update's capabilities.
  await panel.getByRole('button', { name: '创建 API Key', exact: true }).click();
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('Unified create only');
  await dialog.getByRole('checkbox', { name: `${label} · 新增`, exact: true }).check();
  for (const op of ['读取', '更新', '删除', '允许发布']) assert.equal(await dialog.getByRole('checkbox', { name: `${label} · ${op}`, exact: true }).isChecked(), false);
  await page.screenshot({ path: f.artifact('unified-create-only.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '创建 API Key', exact: true }).click();
  const createSecret = await dialog.getByRole('textbox', { name: 'API Key', exact: true }).inputValue();
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  const createKey = (await api('/user/api-keys')).keys.find(k => k.name === 'Unified create only');
  assert.deepEqual(createKey.permissions, [{ tableId: table.id, canRead: false, canCreate: true, canUpdate: false, canDelete: false }]);
  assert.deepEqual(createKey.documentPermissions, [{ tableId: table.id, canRead: false, canCreate: true, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false }]);
  assert.deepEqual(createKey.blogPermissions, []);
  const created = await call(createSecret, 'addRow', { tableId: table.id, cells: {} });
  const createInput = { tableId: table.id, rowId: created.id, content, idempotencyKey: id() };
  const firstBodies = await Promise.all([call(createSecret, 'createDocument', createInput), call(createSecret, 'createDocument', createInput)]);
  assert.deepEqual(firstBodies[0], firstBodies[1], 'concurrent duplicate first creation is idempotent');
  const original = await command('getDocument', scope);
  const bodyState = async () => ({
    document: await command('getDocument', scope), blog: await command('getBlog', { siteId: blog.id }),
    images: await db`select id from document_images where document_id=${original.id} order by id`,
    revisions: await db`select document_id, version, content from document_revisions where document_id=${original.id} order by version`,
    receipts: await db`select id from document_receipts where principal_id=${`key:${createKey.id}`} order by id`,
    blogReceipts: await db`select id from blog_receipts where principal_id=${`key:${createKey.id}`} order by id`,
  });
  const beforeDenied = await bodyState();
  const overwrite = { ...scope, expectedVersion: original.version, content, idempotencyKey: id() };
  for (let attempt = 0; attempt < 2; attempt++) {
    await call(createSecret, 'replaceDocument', overwrite, 403);
    await call(createSecret, 'uploadDocumentImage', { ...scope, expectedVersion: original.version, name: 'forbidden.png', mimeType: 'image/png', base64: png, idempotencyKey: id() }, 403);
    // No blog scope at all is represented by 404, preserving the existing API boundary.
    await call(createSecret, 'saveBlog', { siteId: blog.id, expectedVersion: blog.version, name: 'Forbidden edit', config, idempotencyKey: id() }, 404);
  }
  await call(createSecret, 'replaceDocument', { ...createInput, expectedVersion: 0 }, 403);
  await call(createSecret, 'getDocument', scope, 403);
  await call(createSecret, 'updateCell', { rowId: row.id, columnId: title.id, value: 'Forbidden title', expectedVersion: 1 }, 403);
  assert.deepEqual(await bodyState(), beforeDenied, 'denied create-only writes do not change body/site/images/revisions/receipts');
  const lazyRow = await command('addRow', { tableId: table.id, cells: {} });
  await panel.getByRole('button', { name: '编辑 Unified read', exact: true }).click();
  await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('Unified update only');
  await dialog.getByRole('checkbox', { name: `${label} · 读取`, exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: `${label} · 更新`, exact: true }).check();
  assert.equal(await dialog.getByRole('checkbox', { name: `${label} · 新增`, exact: true }).isChecked(), false);
  for (const width of [1440, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: f.artifact(`unified-${width}-${theme}.png`), animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const updateKey = (await api('/user/api-keys')).keys.find(k => k.name === 'Unified update only');
  assert.deepEqual(updateKey.permissions, [{ tableId: table.id, canRead: false, canCreate: false, canUpdate: true, canDelete: false }]);
  await call(secret, 'addRow', { tableId: table.id, cells: {} }, 403);
  await call(secret, 'getDocument', scope, 403);
  await call(secret, 'replaceDocument', { tableId: table.id, rowId: lazyRow.id, expectedVersion: 0, content, idempotencyKey: id() });
  await call(secret, 'replaceDocument', { ...scope, expectedVersion: 2, content: imageContent, idempotencyKey: id() });
  await call(secret, 'uploadDocumentImage', { ...scope, expectedVersion: 3, name: 'write.png', mimeType: 'image/png', base64: png, idempotencyKey: id() });
  blog = await call(secret, 'saveBlog', { siteId: blog.id, expectedVersion: blog.version, name: 'Edited draft', config, idempotencyKey: id() });
  const build = await command('buildBlog', { siteId: blog.id, expectedVersion: blog.version, idempotencyKey: id() });
  blog = build;
  const previewInput = { siteId: blog.id, buildId: build.revisionId, idempotencyKey: id() };
  await call(secret, 'createBlogPreview', previewInput, 403);
  await call(secret, 'publishBlog', { siteId: blog.id, buildId: build.revisionId, expectedVersion: blog.version, expectedPublishedRevisionId: null, idempotencyKey: id() }, 403);
  await panel.getByRole('button', { name: '编辑 Unified update only', exact: true }).click();
  await dialog.getByRole('checkbox', { name: `${label} · 允许发布`, exact: true }).check();
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const preview = await call(secret, 'createBlogPreview', { ...previewInput, idempotencyKey: id() });
  assert.equal((await fetch(preview.url)).status, 200);
  const built = await call(secret, 'buildBlog', { siteId: blog.id, expectedVersion: blog.version, idempotencyKey: id() });
  const published = await call(secret, 'publishBlog', { siteId: blog.id, buildId: built.revisionId, expectedVersion: built.version, expectedPublishedRevisionId: null, idempotencyKey: id() });
  assert.equal((await fetch(published.publicUrl)).status, 200);
  const saved = (await api('/user/api-keys')).keys.find(k => k.name === 'Unified update only');
  assert.equal(saved.blogPermissions[0].canPublish, true); assert.equal(saved.blogPermissions[0].canBuild, true);
  await api(`/user/api-keys/${saved.id}`, undefined, 'DELETE');
  await call(secret, 'getDocument', scope, 401);
  // The read shortcut uses the same table bundle for newly selected resources.
  await panel.getByRole('button', { name: '一键启用 Grok Bot', exact: true }).click();
  await dialog.getByRole('checkbox', { name: `${workspace.name} / Unified articles`, exact: true }).check();
  const grokCreated = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/user/api-keys');
  await dialog.getByRole('button', { name: '一键启用 Grok Bot', exact: true }).click();
  assert.equal((await grokCreated).status(), 201);
  const grok = (await api('/user/api-keys')).keys.find(k => k.name === 'Grok Bot');
  assert.equal(grok.documentPermissions[0].canRead, true); assert.equal(grok.blogPermissions[0].canRead, true);
  assert.equal(grok.blogPermissions[0].canBuild, false); assert.equal(grok.blogPermissions[0].canPublish, false);
  assert.deepEqual(f.errors, []);
  console.log('PASS unified Key HTTP boundary: UI-created read includes body/image; read rejects writes; create-only cannot overwrite/upload/configure and denial has no side effects; update-only supports lazy body/upload/drafts but cannot add rows; preview/publish denied until explicit allow; revocation; desktop/320px light/dark.');
} finally { await db.end(); await f.close(); await rm(directory, { recursive: true, force: true }); }
