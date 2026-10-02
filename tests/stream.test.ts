import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStream } from '../src/stream.js';
import { normalizeMessages } from '../electron/prime.js';

test('a streamed reply replaces its previous version and tool-call rows, keeping earlier messages', () => {
  const previous = [
    { id: 'user-1', role: 'user' as const, content: 'Hi' },
    { id: 'assistant-2', role: 'assistant' as const, content: 'Hel' },
    { id: 'assistant-2-call-0', role: 'tool' as const, content: '{}' },
  ];
  const next = mergeStream(previous, 'assistant-2', [{ id: 'assistant-2', role: 'assistant', content: 'Hello' }]);
  assert.deepEqual(next.map(m => [m.id, m.content]), [['user-1', 'Hi'], ['assistant-2', 'Hello']]);
});

test('a first streamed chunk is appended; an unrelated ID with the same prefix is kept', () => {
  const previous = [{ id: 'assistant-2-2', role: 'assistant' as const, content: 'Other' }];
  const next = mergeStream(previous, 'assistant-2', [{ id: 'assistant-2', role: 'assistant', content: 'New' }]);
  assert.deepEqual(next.map(m => m.id), ['assistant-2-2', 'assistant-2']);
});

test('generated message IDs depend on role and timestamp, not position, and stay unique', () => {
  const reply = { role: 'assistant', content: 'Same', timestamp: 5 };
  assert.equal(normalizeMessages([reply])[0].id, normalizeMessages([{ role: 'user', content: 'a', timestamp: 1 }, reply])[1].id);
  const ids = normalizeMessages([{ role: 'toolResult', content: 'a', timestamp: 9 }, { role: 'toolResult', content: 'b', timestamp: 9 }]).map(m => m.id);
  assert.equal(new Set(ids).size, 2);
});
