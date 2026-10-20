import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
  await readFile(new URL('../src/pages/docs/DocsArticlePage.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

function render(slug, language, pageExists) {
  const element = (type, props) => ({ type, props });
  const page = { slug, title: 'Title', description: 'Description', body: [] };
  const modules = {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-router-dom': { Navigate: 'Navigate', Link: 'Link', useParams: () => ({ slug }) },
    'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language } }) },
    '@/data/docs': { listDocsPages: () => pageExists ? [page] : [], getDoc: () => pageExists ? page : undefined },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => modules[name] ?? {} });
  return exports.DocsArticlePage();
}

test('retired docs replace their URL with the common page in both languages, before and after old content removal', () => {
  const replacements = { 'record-documents': '/docs/tables', 'document-api': '/docs/rest', blogging: '/docs/views', 'blog-api': '/docs/sites' };
  for (const language of ['en', 'zh-CN']) for (const pageExists of [true, false]) {
    for (const [slug, target] of Object.entries(replacements)) {
      const result = render(slug, language, pageExists);
      assert.equal(result.type, 'Navigate');
      assert.equal(result.props.to, target);
      assert.equal(result.props.replace, true);
    }
  }
});

test('current docs remain accessible and unknown slugs keep the docs-home fallback', () => {
  assert.equal(render('tables', 'en', true).type, 'main');
  for (const slug of ['missing', 'constructor', '__proto__', undefined]) {
    const result = render(slug, 'zh-CN', false);
    assert.equal(result.type, 'Navigate');
    assert.equal(result.props.to, '/docs');
  }
});
