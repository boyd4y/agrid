import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('development MCP proxy preserves path, body and Bearer header on the configured API target', async () => {
  const requests = [];
  const backend = createHttpServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, method: request.method, authorization: request.headers.authorization, body });
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Fixture authentication required' }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const previous = process.env.TABDO_API_TARGET;
  process.env.TABDO_API_TARGET = `http://127.0.0.1:${backend.address().port}`;
  let vite;
  try {
    vite = await createServer({
      root: fileURLToPath(new URL('../', import.meta.url)),
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    for (const path of ['/mcp', '/mcp?probe=1', '/mcp/']) {
      const response = await fetch(origin + path, { method: 'POST', headers: { Authorization: 'Bearer tab_fixture', 'Content-Type': 'application/json' }, body });
      assert.equal(response.status, 401);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await response.json(), { error: 'Fixture authentication required' });
      assert.deepEqual(requests.at(-1), { url: path, method: 'POST', authorization: 'Bearer tab_fixture', body });
    }
    // An unrelated SPA route starting with the same letters must not reach the API.
    assert.equal((await fetch(origin + '/mcprofile')).status, 200);
    assert.equal(requests.length, 3);
  } finally {
    if (previous === undefined) delete process.env.TABDO_API_TARGET;
    else process.env.TABDO_API_TARGET = previous;
    await vite?.close();
    await new Promise(resolve => backend.close(resolve));
  }
});
