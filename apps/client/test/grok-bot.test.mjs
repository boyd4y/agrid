import assert from 'node:assert/strict';
import test from 'node:test';
import { enableGrokBot } from '../src/components/settings/grok-bot.ts';

test('enable grants only Read on explicitly selected tables and returns the one-time secret', async () => {
  const saved = { key: { id: 'key', name: 'Grok Bot' }, secret: 'tab_fixture' };
  let input;
  const result = await enableGrokBot({
    listApiKeys: async () => ({ keys: [], tables: [{ id: 'a' }, { id: 'b' }] }),
    createApiKey: async value => { input = value; return saved; },
  }, ['b']);
  assert.equal(result, saved);
  assert.deepEqual(input, { name: 'Grok Bot', permissions: ['b'].map(tableId => ({ tableId, canRead: true, canCreate: false, canUpdate: false, canDelete: false })) });
});

test('repeat enable refreshes active keys, reuses metadata, and never creates or exposes a secret', async () => {
  const existing = { id: 'existing', name: 'Grok Bot', prefix: 'tab_abc', permissions: [] };
  let lists = 0;
  const api = {
    listApiKeys: async () => { lists++; return { keys: [existing], tables: [] }; },
    createApiKey: async () => assert.fail('must not create a duplicate'),
  };
  assert.deepEqual(await enableGrokBot(api, []), { key: existing });
  assert.deepEqual(await enableGrokBot(api, []), { key: existing });
  assert.equal(lists, 2);
});

test('empty tables do not create a key, and API failures propagate for the UI error message', async () => {
  assert.equal(await enableGrokBot({
    listApiKeys: async () => ({ keys: [], tables: [] }),
    createApiKey: async () => assert.fail('empty table scope'),
  }, ['a']), null);
  await assert.rejects(enableGrokBot({
    listApiKeys: async () => { throw new Error('Permission denied'); },
    createApiKey: async () => assert.fail('listing failed'),
  }, []), /Permission denied/);
});

test('empty or unavailable selections never grant access, and duplicate IDs do not duplicate grants', async () => {
  const api = {
    listApiKeys: async () => ({ keys: [], tables: [{ id: 'a' }, { id: 'b' }] }),
    createApiKey: async () => assert.fail('no valid selected tables'),
  };
  for (const selection of [[], ['removed']]) {
    assert.equal(await enableGrokBot(api, selection), null);
  }
  let input;
  await enableGrokBot({ ...api, createApiKey: async value => { input = value; return {}; } }, ['b', 'b', 'removed']);
  assert.deepEqual(input.permissions, [{ tableId: 'b', canRead: true, canCreate: false, canUpdate: false, canDelete: false }]);
});
