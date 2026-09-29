import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationToJson, conversationToMarkdown, exportFileName } from '../src/export.js';
import type { Message, Session } from '../shared/types.js';

const session: Session = { id: 's1', title: 'Fix   the bug', cwd: '/work/app', model: '', status: 'idle', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' };
const messages: Message[] = [
  { id: '1', role: 'user', content: 'Please fix it', timestamp: '2024-01-01T00:00:00Z' },
  { id: '2', role: 'tool', toolName: 'bash', content: 'echo ```hi```' },
  { id: '3', role: 'assistant', content: 'Done.' },
];

test('Markdown export has a header, labelled turns and fences that tool output cannot close', () => {
  const md = conversationToMarkdown(session, messages);
  assert.match(md, /^# Fix the bug\n/);
  assert.match(md, /- Model: CLI default/);
  assert.match(md, /## You · 2024-01-01T00:00:00Z\n\nPlease fix it/);
  assert.match(md, /## Tool: bash\n\n````\necho ```hi```\n````/);
  assert.match(md, /## Prime\n\nDone\./);
});

test('JSON export keeps session identity and every message', () => {
  const parsed = JSON.parse(conversationToJson(session, messages));
  assert.equal(parsed.session.id, 's1');
  assert.equal(parsed.messages.length, 3);
});

test('export file names are safe and fall back when the title has no usable characters', () => {
  assert.equal(exportFileName('Fix the bug / now!', 'markdown'), 'fix-the-bug-now.md');
  assert.equal(exportFileName('../../etc', 'json'), 'etc.json');
  assert.equal(exportFileName('???', 'json'), 'conversation.json');
});
