import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { apiKeyPlaceholder, connectionValues } from '../src/components/connections/connection-guide.ts';

for (const language of ['en', 'zh-CN']) {
  const app = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${language}/app.json`, import.meta.url)));
  const i18n = createInstance();
  await i18n.init({ lng: language, resources: { [language]: { app } }, defaultNS: 'app', interpolation: { escapeValue: false } });
  const instructions = options => i18n.t('settings.connections.instructions', connectionValues('https://deploy.example.test:8443/nested?ignored=1', options));

  test(`${language}: complete natural-language instructions use deployment origin and an explicit placeholder`, () => {
    const text = instructions();
    assert(text.includes('https://deploy.example.test:8443/mcp'));
    assert(text.includes(`Authorization: Bearer ${apiKeyPlaceholder}`));
    assert(text.includes('Streamable HTTP'));
    assert(!text.includes('nested'));
    assert(!/claude|codex|cursor|grok|mcpServers|stdio|--header/i.test(text));
    assert(!text.includes('{{'));
  });

  test(`${language}: newly created secret appears verbatim and is never retained by later calls`, () => {
    const secret = `tab_inert_'"$&<>\\; {{endpoint}}`;
    assert(instructions({ secret }).includes(`Authorization: Bearer ${secret}`));
    assert(instructions().includes(apiKeyPlaceholder));
    assert(!instructions().includes(secret));
    assert(instructions({ secret: '' }).includes(apiKeyPlaceholder));
  });

  test(`${language}: public instructions discard an accidentally supplied secret`, () => {
    const secret = 'tab_inert_private';
    assert.equal(instructions({ publicMode: true, secret }), instructions());
    assert(!instructions({ publicMode: true, secret }).includes(secret));
  });
}
