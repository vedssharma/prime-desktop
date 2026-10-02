import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrimeService, normalizeMessages, normalizeSession, parseSavedTranscript } from '../electron/prime.js';
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
  assert.deepEqual(parseSavedTranscript(records.map(record => JSON.stringify(record)).join('\n') + '\n{"').map(m => m.content), ['Question', 'Current answer']);
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

test('daemon sessions map status, title, model and dates with safe fallbacks', () => {
  const epoch = new Date(0).toISOString();
  assert.deepEqual(normalizeSession({}), { id: '', title: 'Untitled session', cwd: '', model: '', status: 'idle', updatedAt: epoch, createdAt: epoch });
  assert.equal(normalizeSession({ sessionId: 'persistent', id: 'runtime' }).id, 'persistent');
  assert.equal(normalizeSession({ id: 'runtime' }).id, 'runtime');
  assert.equal(normalizeSession({ sessionName: 'Named', name: 'n', firstMessage: 'f' }).title, 'Named');
  assert.equal(normalizeSession({ sessionName: 5, name: 'Fallback name', firstMessage: 'f' }).title, 'Fallback name');
  assert.equal(normalizeSession({ firstMessage: 'First prompt' }).title, 'First prompt');
  assert.equal(normalizeSession({ model: { name: 'Display', id: 'raw' } }).model, 'Display');
  assert.equal(normalizeSession({ model: { id: 'raw' } }).model, 'raw');
  for (const raw of [{ workerState: 'failed', isStreaming: true }, { rosterStatus: 'error', activity: 'working' }]) assert.equal(normalizeSession(raw).status, 'error');
  for (const flag of ['isStreaming', 'isCompacting', 'isBashRunning', 'hasRunningRlmChildren']) assert.equal(normalizeSession({ [flag]: true }).status, 'running', flag);
  assert.equal(normalizeSession({ activity: 'working' }).status, 'running');
  assert.equal(normalizeSession({ activity: 'idle', workerState: 'ready' }).status, 'idle');
  const created = '2024-01-02T03:04:05.000Z', modified = '2024-02-03T04:05:06.000Z', active = 1_710_000_000_000;
  assert.deepEqual(normalizeSession({ created, modified, lastActivityAt: active }), { ...normalizeSession({}), createdAt: created, updatedAt: new Date(active).toISOString() });
  assert.equal(normalizeSession({ created, modified, lastActivityAt: 'not a date' }).updatedAt, modified);
  assert.equal(normalizeSession({ created, modified: {} }).updatedAt, created);
  assert.equal(normalizeSession({ created: 'garbage' }).createdAt, epoch);
});

test('message mapping formats shell runs, images, plain strings and generated ids', () => {
  const messages = normalizeMessages([
    { role: 'user', timestamp: '2024-01-02T03:04:05Z', content: 'Plain string' },
    { role: 'bashExecution', command: 'ls -a', output: '.\n..' },
    { id: 'img', role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', data: 'base64' }] },
    { id: 'call', role: 'assistant', content: [{ type: 'toolCall', name: 'read' }] },
    { id: 'empty', role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden' }] },
    { id: 'notice', role: 'custom', display: true, content: 'Visible custom' },
    { id: 'err', role: 'toolResult', errorMessage: 'Denied', content: 'partial', toolName: 'write' },
  ]);
  assert.deepEqual(messages, [
    { id: 'user-2024-01-02T03:04:05Z', role: 'user', content: 'Plain string', timestamp: '2024-01-02T03:04:05.000Z' },
    { id: 'bashExecution-1-1', role: 'tool', content: '$ ls -a\n.\n..', timestamp: undefined },
    { id: 'img', role: 'user', content: 'Look\n[Image attachment unavailable: unsupported type or size]', timestamp: undefined },
    { id: 'call-call-0', role: 'tool', toolName: 'read', timestamp: undefined, content: '{}' },
    { id: 'notice', role: 'system', content: 'Visible custom', timestamp: undefined },
    { id: 'err', role: 'tool', content: 'partial\n\nError: Denied', timestamp: undefined, toolName: 'write' },
  ]);
});

test('linear v1 transcripts keep every entry and cyclic parent links terminate', () => {
  const lines = (records: object[]) => records.map(record => JSON.stringify(record)).join('\n');
  const linear = parseSavedTranscript(lines([
    { type: 'session', id: 'header' },
    { type: 'message', id: 'a', message: { role: 'user', content: 'One' } },
    { type: 'model_change', id: 'm' },
    { type: 'message', id: 'b', message: { role: 'assistant', content: 'Two' } },
  ]));
  assert.deepEqual(linear.map(message => [message.id, message.content]), [['a', 'One'], ['b', 'Two']]);
  const cyclic = parseSavedTranscript(lines([
    { type: 'session', id: 'header' },
    { type: 'message', id: 'a', parentId: 'b', message: { role: 'user', content: 'One' } },
    { type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: 'Two' } },
  ]));
  assert.deepEqual(cyclic.map(message => message.content), ['One', 'Two']);
  assert.deepEqual(parseSavedTranscript('\n  \n'), []);
});

test('saved transcripts reject missing files, broken headers and multiple headers; unchanged files are cached', async () => {
  const daemon = await fakeDaemon(() => ({ sessions: ['cached', 'broken', 'twice', 'nofile'].map(id => ({ sessionId: id, ...(id === 'nofile' ? {} : { sessionFile: join(daemon.directory, `${id}.jsonl`) }) })) }));
  const service = new PrimeService({ socketPath: daemon.socketPath });
  const file = (id: string) => join(daemon.directory, `${id}.jsonl`);
  const message = (id: string, content: string) => JSON.stringify({ type: 'message', id, parentId: null, message: { role: 'user', content } });
  try {
    await writeFile(file('broken'), '{not json\n' + message('a', 'x') + '\n');
    await assert.rejects(service.getMessages('broken'), /Invalid saved session header/);
    await writeFile(file('twice'), JSON.stringify({ type: 'session', id: 'twice' }) + '\n' + message('a', 'x') + '\n' + JSON.stringify({ type: 'session', id: 'other' }) + '\n');
    await assert.rejects(service.getMessages('twice'), /Multiple session headers/);
    await assert.rejects(service.getMessages('nofile'), /no saved transcript/);
    await assert.rejects(service.getMessages('unknown'), /Session not found/);
    await writeFile(file('cached'), JSON.stringify({ type: 'session', id: 'cached' }) + '\n' + message('a', 'First') + '\n');
    const first = await service.getMessages('cached');
    assert.equal(await service.getMessages('cached'), first, 'an unchanged file returns the cached result');
    await writeFile(file('cached'), JSON.stringify({ type: 'session', id: 'cached' }) + '\n' + message('a', 'Changed text') + '\n');
    assert.equal((await service.getMessages('cached'))[0].content, 'Changed text');
  } finally { service.close(); await daemon.close(); }
});

test('shared list hides child runtimes, sorts newest first, and rejects malformed catalogs', async () => {
  let sessions: unknown = [
    { sessionId: 'older', lastActivityAt: '2024-01-01T00:00:00Z' },
    { sessionId: 'subagent', runtimeKind: 'subagent' }, { sessionId: 'rlm', rlmDepth: 1 }, { sessionId: 'child', parentSessionId: 'older' },
    { cwd: '/no/id' }, { sessionId: 'newer', lastActivityAt: '2024-03-01T00:00:00Z' },
  ];
  const daemon = await fakeDaemon(() => ({ sessions }));
  const service = new PrimeService({ socketPath: daemon.socketPath });
  try {
    const listed = await service.listSessions();
    assert.deepEqual(listed.map(s => [s.id, s.ownership, s.writable]), [['newer', 'shared', false], ['older', 'shared', false]]);
    for (const malformed of ['not a list', [1], [null], undefined]) {
      sessions = malformed;
      await assert.rejects(service.listSessions(), /Invalid daemon session list/, JSON.stringify(malformed));
    }
  } finally { service.close(); await daemon.close(); }
  const offline = new PrimeService({ socketPath: join(daemon.directory, 'absent.sock') });
  try { await assert.rejects(offline.listSessions(), /ENOENT/); } finally { offline.close(); }
});

test('status reports the daemon version or an honest disconnected state', async () => {
  const daemon = await fakeDaemon(undefined, { appVersion: '2.0.0', version: '0.9.5' });
  const connected = new PrimeService({ socketPath: daemon.socketPath, home: '/fixture/home' });
  const offline = new PrimeService({ socketPath: join(daemon.directory, 'absent.sock'), home: '/fixture/home' });
  try {
    const status = await connected.status();
    assert.equal(status.connected, true); assert.equal(status.version, '2.0.0'); assert.equal(status.home, '/fixture/home');
    assert.equal(status.readOnly, true); assert.equal(status.canCreateOwned, false); assert.match(status.ownedReason ?? '', /not enabled/);
    const down = await offline.status();
    assert.equal(down.connected, false); assert.match(down.error ?? '', /ENOENT/); assert.equal(down.home, '/fixture/home'); assert.equal(down.readOnly, true);
  } finally { connected.close(); offline.close(); await daemon.close(); }
  const plain = await fakeDaemon();
  const service = new PrimeService({ socketPath: plain.socketPath });
  try { assert.equal((await service.status()).version, '0.9.5'); } finally { service.close(); await plain.close(); }
});

test('CLI discovery prefers the configured executable, then PRIME_AGENT_BIN, then ~/.local/bin, and gates on 0.9.6', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cli-discovery-'));
  const home = join(dir, 'home'); const previous = process.env.PRIME_AGENT_BIN;
  const cli = async (path: string, version: string) => { await writeFile(path, `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`); await chmod(path, 0o700); return path; };
  const support = async (options: ConstructorParameters<typeof PrimeService>[0]) => {
    const service = new PrimeService({ desktopDir: join(dir, 'desktop'), socketPath: join(dir, 'absent.sock'), home, ...options });
    try { const status = await service.status(); return [status.canCreateOwned, status.ownedReason ?? ''] as const; } finally { service.close(); }
  };
  try {
    delete process.env.PRIME_AGENT_BIN;
    await mkdir(join(home, '.local/bin'), { recursive: true });
    await cli(join(home, '.local/bin/prime-agent'), 'prime-agent 0.9.6');
    assert.deepEqual(await support({}), [true, '']);
    process.env.PRIME_AGENT_BIN = await cli(join(dir, 'env-cli'), '0.9.5');
    const [allowed, reason] = await support({});
    assert.equal(allowed, false); assert.match(reason, /^Prime Agent 0\.9\.5 is installed\. Desktop-owned sessions currently require verified Prime Agent 0\.9\.6/);
    assert.deepEqual(await support({ executable: await cli(join(dir, 'configured'), '0.9.6') }), [true, '']);
    for (const version of ['0.9.60', '10.9.6']) assert.equal((await support({ executable: await cli(join(dir, `v-${version}`), version) }))[0], false, version);
    assert.match((await support({ executable: join(dir, 'missing') }))[1], /Install Prime Agent 0\.9\.6/);
    const [readOnlyAllowed, readOnlyReason] = await support({ executable: join(dir, 'configured'), readOnly: true });
    assert.equal(readOnlyAllowed, false); assert.match(readOnlyReason, /not enabled/);
  } finally {
    if (previous === undefined) delete process.env.PRIME_AGENT_BIN; else process.env.PRIME_AGENT_BIN = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('switching between saved transcripts reuses each cached parse, and the oldest is evicted past the limit', async () => {
  const ids = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
  const daemon = await fakeDaemon(() => ({ sessions: ids.map(id => ({ sessionId: id, sessionFile: join(daemon.directory, `${id}.jsonl`) })) }));
  const service = new PrimeService({ socketPath: daemon.socketPath });
  const message = (content: string) => JSON.stringify({ type: 'message', id: 'm', parentId: null, message: { role: 'user', content } });
  try {
    for (const id of ids) await writeFile(join(daemon.directory, `${id}.jsonl`), JSON.stringify({ type: 'session', id }) + '\n' + message(`Text of ${id}`) + '\n');
    const s0 = await service.getMessages('s0');
    const s1 = await service.getMessages('s1');
    assert.equal(await service.getMessages('s0'), s0, 'returning to a recent session does not re-read it');
    assert.equal(await service.getMessages('s1'), s1);
    for (const id of ids.slice(2)) await service.getMessages(id);
    assert.notEqual(await service.getMessages('s0'), s0, 'least recently used transcripts are evicted');
  } finally { service.close(); await daemon.close(); }
});

test('conversation search matches saved text case-insensitively with excerpts and skips unreadable transcripts', async () => {
  const daemon = await fakeDaemon(() => ({ sessions: ['alpha', 'beta', 'spoofed', 'missing'].map(id => ({ sessionId: id, sessionFile: join(daemon.directory, `${id}.jsonl`) })) }));
  const service = new PrimeService({ socketPath: daemon.socketPath });
  const message = (id: string, content: string, parentId: string | null) => JSON.stringify({ type: 'message', id, parentId, message: { role: 'assistant', content } });
  try {
    await writeFile(join(daemon.directory, 'alpha.jsonl'), [JSON.stringify({ type: 'session', id: 'alpha' }), message('a', 'Nothing here', null), message('b', `${'x'.repeat(80)} Fixed the Flaky RETRY loop ${'y'.repeat(80)}`, 'a')].join('\n') + '\n');
    await writeFile(join(daemon.directory, 'beta.jsonl'), [JSON.stringify({ type: 'session', id: 'beta' }), message('a', 'Unrelated', null)].join('\n') + '\n');
    // A file whose header names another session must never leak its text under this session.
    await writeFile(join(daemon.directory, 'spoofed.jsonl'), [JSON.stringify({ type: 'session', id: 'someone-else' }), message('a', 'flaky retry secret', null)].join('\n') + '\n');
    const found = await service.searchSessions('flaky retry');
    assert.deepEqual(found.map(match => match.id), ['alpha']);
    assert.match(found[0].snippet, /^…x+ Fixed the Flaky RETRY loop y+…$/);
    assert.ok(found[0].snippet.length < 140);
    assert.deepEqual(await service.searchSessions(' f '), [], 'single characters are not searched');
    assert.deepEqual(await service.searchSessions('absent phrase'), []);
  } finally { service.close(); await daemon.close(); }
});
