import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DIFF_ROWS, diffCounts, editCallDiff, parseAgentDiff, toolDiff } from '../src/toolDiff.js';

test('parses the agent edit diff with line numbers and skipped-line markers', () => {
  const rows = parseAgentDiff("  9 a\n-10 old\n+10 new\n    ...\n 40   indented");
  assert.deepEqual(rows, [
    { kind: 'context', number: '9', text: 'a' },
    { kind: 'del', number: '10', text: 'old' },
    { kind: 'add', number: '10', text: 'new' },
    { kind: 'gap', text: '…' },
    { kind: 'context', number: '40', text: '  indented' },
  ]);
});

test('falls back to raw output for text that is not an agent diff, or a huge one', () => {
  assert.equal(parseAgentDiff('Successfully replaced text'), undefined);
  assert.equal(parseAgentDiff(''), undefined);
  assert.equal(parseAgentDiff(Array.from({ length: MAX_DIFF_ROWS + 1 }, (_, i) => `+${i} x`).join('\n')), undefined);
});

test('edit call arguments become proposed replacements, including the legacy form', () => {
  const diff = editCallDiff(JSON.stringify({ path: 'a.ts', edits: [{ oldText: 'x\ny\n', newText: 'z' }, { oldText: 'p', newText: 'q' }] }));
  assert.equal(diff?.path, 'a.ts');
  assert.equal(diff?.applied, false);
  assert.deepEqual(diff?.rows.map(row => `${row.kind}:${row.text}`), ['del:x', 'del:y', 'add:z', 'gap:…', 'del:p', 'add:q']);
  assert.deepEqual(diffCounts(diff!.rows), { added: 2, removed: 3 });
  assert.deepEqual(editCallDiff(JSON.stringify({ path: 'b.ts', oldText: 'o', newText: 'n' }))?.rows.length, 2);
  assert.equal(editCallDiff('{"path":"a.ts","edits":[{"oldText":1}]}'), undefined);
  assert.equal(editCallDiff('not json'), undefined);
  assert.equal(editCallDiff('{"path":"a.ts"}'), undefined);
});

test('only edit tool steps get a diff view, preferring the applied diff', () => {
  const args = JSON.stringify({ path: 'a.ts', edits: [{ oldText: 'a', newText: 'b' }] });
  assert.equal(toolDiff({ role: 'tool', toolName: 'bash', content: args }), undefined);
  assert.equal(toolDiff({ role: 'assistant', toolName: 'edit', content: args }), undefined);
  assert.equal(toolDiff({ role: 'tool', toolName: 'edit', content: args })?.applied, false);
  const applied = toolDiff({ role: 'tool', toolName: 'edit', content: 'Done', diff: '-1 a\n+1 b' });
  assert.equal(applied?.applied, true);
  assert.equal(applied?.rows.length, 2);
});
