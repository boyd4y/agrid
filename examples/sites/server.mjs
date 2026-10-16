import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const allowed = { '/': ['catalog.html','text/html'], '/catalog.html': ['catalog.html','text/html'], '/lead-form.html': ['lead-form.html','text/html'], '/site.js': ['site.js','text/javascript'], '/site.css': ['site.css','text/css'] };
const port = Number(process.env.SITE_EXAMPLES_PORT || 4178);
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  try {
    const asset = path === '/tabdo.js' ? new URL('../../packages/sdk/dist/tabdo.js', import.meta.url) : allowed[path] && new URL(allowed[path][0], import.meta.url);
    if (!asset) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'content-type': (path === '/tabdo.js' ? 'text/javascript' : allowed[path][1]) + '; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    response.end(await readFile(asset));
  } catch { response.writeHead(503); response.end('Build @tabdo/sdk before starting the examples.'); }
}).listen(port, '127.0.0.1', () => console.log(`Site examples: http://127.0.0.1:${port}`));
