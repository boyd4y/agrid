/** Test resources use only ordinary table, row and view contracts. */
export async function createSiteViewFixture(api, command, name) {
  const table = await api('/tables', { name: `${name} source` });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const view = await command('createView', { tableId: table.id, type: 'site', name,
    config: { template: 'blog', authorName: 'Public author', description: '', language: 'en', mapping: { title: title.id }, articles: [] }, idempotencyKey: crypto.randomUUID() });
  return { id: view.site.id, viewId: view.id, tableId: table.id, titleId: title.id, view };
}
export const rowBody = (command, input) => command('getRow', { rowId: input.rowId, includeBody: true, bodyFormat: 'html' }).then(row => row.body);
