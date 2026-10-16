import { createClient } from './tabdo.js';

// Supply public configuration in the URL fragment, or replace these defaults.
// Example: #url=http%3A%2F%2Flocalhost%3A3001&key=tab_...&table=TABLE_ID
const settings = new URLSearchParams(location.hash.slice(1));
const url = settings.get('url') || 'http://localhost:3001';
const key = settings.get('key') || '';
const tableId = settings.get('table') || '';
const status = document.querySelector('#status');
if (!key || !tableId) {
  status.textContent = 'Add #url=YOUR_API_URL&key=YOUR_API_KEY&table=TABLE_ID to this page URL. Create the key in Settings → API Key and grant the required table operations.';
} else {
  try {
    const tabdo = createClient({ url, key }), table = tabdo.table(tableId);
    const columns = await table.columns();
    if (document.querySelector('#catalog')) {
      let cursor = null, busy = false;
      const more = document.querySelector('#more');
      async function load() {
        if (busy) return; busy = true; more.disabled = true;
        try {
          const page = await table.list({ limit: 12, cursor });
          for (const row of page.rows) {
            const article = document.createElement('article');
            const title = columns.find(column => column.type === 'text' && column.readable);
            const heading = document.createElement('h2'); heading.textContent = String(row.cells[title?.id] ?? 'Untitled'); article.append(heading);
            for (const file of row.files.filter(file => file.mimeType.startsWith('image/'))) {
              const image = document.createElement('img'); image.crossOrigin = 'anonymous'; image.src = file.url; image.alt = file.name; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; article.append(image);
            }
            for (const column of columns.filter(column => column.readable && column.id !== title?.id && !['file','relation','person'].includes(column.type))) {
              const value = row.cells[column.id]; if (value === null || value === undefined) continue;
              const line = document.createElement('p');
              line.textContent = `${column.name}: ${Array.isArray(value) ? value.join(', ') : String(value)}`; article.append(line);
            }
            document.querySelector('#catalog').append(article);
          }
          cursor = page.nextCursor; more.hidden = !page.hasMore;
          status.textContent = document.querySelector('#catalog').children.length ? '' : 'No content yet.';
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; more.disabled = false; }
      }
      more.addEventListener('click', load); await load();
    } else {
      const form = document.querySelector('#lead-form'), submit = document.querySelector('#submit');
      const inputs = [];
      for (const column of columns.filter(column => column.writable && ['text','number'].includes(column.type))) {
        const label = document.createElement('label'); label.textContent = column.name;
        const input = document.createElement('input'); input.type = 'text'; input.name = column.id; input.maxLength = 2000;
        if (column.type === 'number') input.inputMode = 'decimal';
        label.append(input); document.querySelector('#fields').append(label); inputs.push({ column, input });
      }
      if (!inputs.length) { status.textContent = 'No writable text or number fields are available. Use a key with create permission.'; }
      else {
        form.hidden = false; status.textContent = '';
        form.addEventListener('submit', async event => {
          event.preventDefault(); if (submit.disabled) return;
          const cells = Object.fromEntries(inputs.filter(({ input }) => input.value.trim()).map(({ column, input }) => [column.id, column.type === 'number' ? Number(input.value) : input.value.trim()]));
          if (!Object.keys(cells).length) { status.textContent = 'Enter a message before sending.'; return; }
          if (Object.values(cells).some(value => typeof value === 'number' && !Number.isFinite(value))) { status.textContent = 'Enter a valid number.'; return; }
          submit.disabled = true; status.textContent = 'Sending…';
          try { await table.create(cells); form.reset(); status.textContent = 'Message received. Thank you!'; }
          catch (error) { status.textContent = error.message; }
          finally { submit.disabled = false; }
        });
      }
    }
  } catch (error) { status.textContent = error.message; }
}
