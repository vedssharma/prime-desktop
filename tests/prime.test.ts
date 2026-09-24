import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrimeService, normalizeMessages, parseSavedTranscript } from '../electron/prime.js';
import { fakeDaemon } from './fake-daemon.js';

test('read-only catalog hides children and transcript reads never attach or wake sessions', async () => {
  let saved = '';
  const daemon = await fakeDaemon(command => {
    if (command.type === 'list') return { sessions: [
      { id: 'active', activeSessionId: 'active', sessionId: 'stable', cwd: '/project', isStreaming: true, sessionName: 'Live' },
      { id: 'old', sessionId: 'old', cwd: '/project', sessionFile: saved },
      { id: 'child', sessionId: 'child', runtimeKind: 'subagent', rlmDepth: 1 },
    ] };
    if (command.type === 'get_messages') return { messages: [{ role: 'user', content: 'hello' }] };
    if (command.type === 'get_state') return { streamingMessage: { role: 'assistant', content: [{ type: 'text', text: 'Streaming reply' }] } };
    throw new Error(`Unexpected command: ${command.type}`);
  });
  saved = join(daemon.directory, 'saved.jsonl');
  await writeFile(saved, JSON.stringify({ type: 'message', id: 'm1', parentId: null, message: { role: 'assistant', content: 'Saved reply' } }) + '\n');
  const service = new PrimeService({ socketPath: daemon.socketPath, readOnly: true });
  try {
    assert.equal((await service.status()).connected, true);
    const sessions = await service.listSessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].id, 'stable');
    assert.deepEqual((await service.getMessages('stable')).map(m => m.content), ['hello', 'Streaming reply']);
    assert.equal((await service.getMessages('old'))[0].content, 'Saved reply');
    await assert.rejects(service.sendMessage('stable', 'no'), /read-only/);
    await assert.rejects(service.deleteSession('stable'), /read-only/);
    await assert.rejects(service.renameSession('old', 'no'), /read-only/);
    await assert.rejects(service.interruptSession('stable'), /read-only/);
    await assert.rejects(service.createSession({ cwd: daemon.directory, prompt: 'no' }), /read-only/);
    assert(daemon.commands.every(c => ['list', 'get_messages', 'get_state'].includes(c.type)));
  } finally { service.close(); await daemon.close(); }
});

test('create/send/stop/rename/delete use resident daemon operations and stable UI IDs', async () => {
  const daemon = await fakeDaemon(command => {
    if (command.type === 'list') return { sessions: [{ id: 'active-1', activeSessionId: 'active-1', sessionId: 'saved-1', sessionFile: '/known/session.jsonl', cwd: '/project' }] };
    if (command.type === 'create') return { id: 'active-1', activeSessionId: 'active-1', sessionId: 'saved-1', sessionFile: '/known/session.jsonl', cwd: command.config.cwd };
    if (command.type === 'delete_saved_session') return { ok: true };
    return {};
  });
  const service = new PrimeService({ socketPath: daemon.socketPath });
  try {
    const session = await service.createSession({ cwd: daemon.directory, prompt: 'Build a thing', model: 'provider/model' });
    assert.equal(session.id, 'saved-1');
    assert.equal(session.status, 'running');
    await service.sendMessage(session.id, 'Continue');
    await service.interruptSession(session.id);
    await service.renameSession(session.id, 'Renamed');
    await service.deleteSession(session.id);
    const commands = daemon.commands.filter(c => !['ack_result', 'list'].includes(c.type));
    assert.deepEqual(commands.map(c => c.type), ['create', 'prompt', 'prompt', 'abort', 'rename', 'kill', 'delete_saved_session']);
    assert.equal(commands[0].lifecycle, 'resident');
    assert.equal(commands[0].continueRecent, false);
    assert.equal(commands[0].config.provider, 'provider');
    assert.equal(commands[0].config.model, 'model');
    assert.equal(commands[1].activeSessionId, 'active-1');
    assert.equal(commands[1].streamingBehavior, 'followUp');
  } finally { service.close(); await daemon.close(); }
});

test('saved session only resumes on explicit send, using catalog path', async () => {
  const daemon = await fakeDaemon(command => {
    if (command.type === 'list') return { sessions: [{ id: 'old', sessionId: 'old', sessionFile: '/known/old.jsonl', cwd: '/original' }] };
    if (command.type === 'create') return { activeSessionId: 'resumed', sessionId: 'old' };
    return {};
  });
  const service = new PrimeService({ socketPath: daemon.socketPath });
  try {
    await service.listSessions();
    await service.renameSession('old', 'New name');
    assert.equal(daemon.commands.find(c => c.type === 'rename_saved_session').sessionPath, '/known/old.jsonl');
    await service.sendMessage('old', 'Continue');
    assert.equal(daemon.commands.find(c => c.type === 'create').sessionPath, '/known/old.jsonl');
    assert.equal(daemon.commands.find(c => c.type === 'prompt').activeSessionId, 'resumed');
    await assert.rejects(service.sendMessage('/arbitrary/path', 'no'), /Session not found/);
    assert(!daemon.commands.some(c => c.type === 'attach'));
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

test('mutations refresh persistent IDs instead of targeting a switched CLI runtime', async () => {
  let switched = false;
  const daemon = await fakeDaemon(command => {
    if (command.type === 'list') return { sessions: switched
      ? [{ id: 'reused-active', activeSessionId: 'reused-active', sessionId: 'different-session' }, { id: 'original-session', sessionId: 'original-session', sessionFile: '/known/original.jsonl' }]
      : [{ id: 'reused-active', activeSessionId: 'reused-active', sessionId: 'original-session', sessionFile: '/known/original.jsonl' }] };
    return {};
  });
  const service = new PrimeService({ socketPath: daemon.socketPath });
  try {
    await service.listSessions();
    switched = true;
    await service.renameSession('original-session', 'Correct target');
    assert(!daemon.commands.some(c => c.type === 'rename'));
    const rename = daemon.commands.find(c => c.type === 'rename_saved_session');
    assert.equal(rename.sessionPath, '/known/original.jsonl');
  } finally { service.close(); await daemon.close(); }
});

test('model selection splits only the first slash and preserves nested model IDs', async () => {
  const daemon = await fakeDaemon(command => command.type === 'create'
    ? { id: 'active-nested', activeSessionId: 'active-nested', sessionId: 'saved-nested', cwd: command.config.cwd }
    : {});
  const service = new PrimeService({ socketPath: daemon.socketPath });
  try {
    await service.createSession({ cwd: daemon.directory, prompt: 'Test only', model: 'vercel-ai-gateway/openai/gpt-6-astra' });
    const command = daemon.commands.find(c => c.type === 'create');
    assert.equal(command.config.provider, 'vercel-ai-gateway');
    assert.equal(command.config.model, 'openai/gpt-6-astra');
  } finally { service.close(); await daemon.close(); }
});
