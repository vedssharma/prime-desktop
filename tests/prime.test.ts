import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrimeService, normalizeMessages, parseSavedTranscript } from '../electron/prime.js';
import { fakeDaemon } from './fake-daemon.js';

test('legacy daemon blocks every mutation before dispatch', async () => {
  const daemon = await fakeDaemon(() => { throw Error('No request allowed'); });
  const service = new PrimeService({ socketPath: daemon.socketPath });
  try {
    assert.equal((await service.status()).readOnly, true);
    for (const action of [() => service.createSession({ cwd: daemon.directory, prompt: 'no' }), () => service.sendMessage('old', 'no'), () => service.interruptSession('old'), () => service.renameSession('old', 'no'), () => service.deleteSession('old')]) await assert.rejects(action(), /Read-only compatibility/);
    assert.equal(daemon.commands.length, 0);
  } finally { service.close(); await daemon.close(); }
});

test('saved identity is verified and reusable runtime IDs are never read', async () => {
  let saved = '';
  const daemon = await fakeDaemon(command => {
    assert.equal(command.type, 'list');
    return { sessions: [{ sessionId: 'original', activeSessionId: 'reused-runtime', sessionFile: saved }, { sessionId: 'child', runtimeKind: 'subagent' }] };
  });
  saved = join(daemon.directory, 'saved.jsonl');
  const service = new PrimeService({ socketPath: daemon.socketPath });
  try {
    await writeFile(saved, JSON.stringify({ type: 'session', id: 'original' }) + '\n' + JSON.stringify({ type: 'message', id: 'a', parentId: null, message: { role: 'assistant', content: 'Original' } }) + '\n');
    assert.equal((await service.listSessions()).length, 1);
    assert.equal((await service.getMessages('original'))[0].content, 'Original');
    await writeFile(saved, JSON.stringify({ type: 'session', id: 'different' }) + '\n');
    await assert.rejects(service.getMessages('original'), /identity mismatch/);
    assert(daemon.commands.every(c => c.type === 'list'));
  } finally { service.close(); await daemon.close(); }
});

test('message mapping preserves text, tools and errors without exposing hidden custom/thinking', () => {
  const messages = normalizeMessages([
    { role: 'custom', display: false, content: 'hidden' },
    { role: 'assistant', timestamp: 1, content: [{ type: 'thinking', thinking: 'internal' }, { type: 'text', text: 'Answer' }, { type: 'toolCall', name: 'ipython', arguments: { code: '1+1' } }] },
    { role: 'toolResult', toolName: 'ipython', content: [{ type: 'text', text: '2' }] },
    { role: 'assistant', errorMessage: 'Provider unavailable', content: [] },
  ]);
  assert.deepEqual(messages.map(m => m.role), ['assistant', 'tool', 'tool', 'assistant']);
  assert.equal(messages[0].content, 'Answer');
  assert.equal(messages[1].toolName, 'ipython');
  assert.match(messages[3].content, /Provider unavailable/);
});

test('saved transcript follows final branch and tolerates only an incomplete trailing line', () => {
  const records = [
    { type: 'session', id: 'header' },
    { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'Question' } },
    { type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: 'Abandoned answer' } },
    { type: 'message', id: 'c', parentId: 'a', message: { role: 'assistant', content: 'Current answer' } },
    { type: 'session_info', id: 'd', parentId: 'c', name: 'Title' },
  ];
  assert.deepEqual(parseSavedTranscript(records.map(JSON.stringify).join('\n') + '\n{"').map(m => m.content), ['Question', 'Current answer']);
  assert.throws(() => parseSavedTranscript('{broken}\n{}\n'), /invalid JSON/);
});



test('saved history preserves visible custom messages and summaries with active parity', () => {
  const records = [
    { type: 'session', id: 'session' },
    { type: 'custom_message', id: 'a', parentId: null, display: true, content: 'Visible notice' },
    { type: 'custom_message', id: 'b', parentId: 'a', display: false, content: 'Hidden notice' },
    { type: 'branch_summary', id: 'c', parentId: 'b', summary: 'Branch details' },
    { type: 'compaction', id: 'd', parentId: 'c', summary: 'Earlier context' },
  ];
  const saved = normalizeMessages(parseSavedTranscript(records.map(record => JSON.stringify(record)).join('\n')));
  const live = normalizeMessages([
    { id: 'a', role: 'custom', display: true, content: 'Visible notice' },
    { id: 'b', role: 'custom', display: false, content: 'Hidden notice' },
    { id: 'c', role: 'branchSummary', summary: 'Branch details' },
    { id: 'd', role: 'compactionSummary', summary: 'Earlier context' },
  ]);
  assert.deepEqual(saved, live);
  assert.equal(saved.length, 3);
  assert.match(saved[2].content, /Context summary/);
});
