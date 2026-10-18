import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { slashTrigger } from '../src/lib/rich-text-slash.ts';
import { searchRanges } from '../src/lib/rich-text-search.ts';
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, heading: { group: 'block', content: 'inline*' }, codeBlock: { group: 'block', content: 'text*', code: true }, text: { group: 'inline' }, hardBreak: { inline: true, group: 'inline' } }, marks: { bold: {} } });
function state(text, type = 'paragraph', pos = text.length + 1, end = pos) {
  const doc = schema.node('doc', null, [schema.node(type, null, text ? [schema.text(text)] : [])]);
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos, end) });
}
test('slash triggers only from a valid textblock prefix and precisely bounds deletion', () => {
  assert.deepEqual(slashTrigger(state('/Heading 2')), { from: 1, to: 11, query: 'heading 2' });
  assert.deepEqual(slashTrigger(state('/标题 2 保留正文', 'paragraph', 6)), { from: 1, to: 6, query: '标题 2' });
  for (const text of ['hello /heading', 'https://example.com/a', '/usr/local', '/'.repeat(2), '/'+ 'a'.repeat(65)]) assert.equal(slashTrigger(state(text)), null);
  assert.equal(slashTrigger(state('/heading', 'codeBlock')), null);
  assert.equal(slashTrigger(state('/heading', 'paragraph', 1, 4)), null);
});
test('literal search crosses inline marks, preserves offsets after hard breaks and never crosses blocks', () => {
  const bold = schema.marks.bold.create();
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Ab', [bold]), schema.text('c abc [x]'), schema.node('hardBreak'), schema.text('Abc')]), schema.node('paragraph', null, [schema.text('abc')])]);
  assert.deepEqual(searchRanges(doc, 'abc', false), [{ from: 1, to: 4 }, { from: 5, to: 8 }, { from: 13, to: 16 }, { from: 18, to: 21 }]);
  assert.deepEqual(searchRanges(doc, 'abc', true), [{ from: 5, to: 8 }, { from: 18, to: 21 }]);
  assert.deepEqual(searchRanges(doc, '[x]', false), [{ from: 9, to: 12 }]);
  assert.deepEqual(searchRanges(doc, 'Abcabc', false), []);
  assert.deepEqual(searchRanges(doc, '', false), []);
});
