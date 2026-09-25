import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwnedRpcSession, type OwnedRpcTransport } from '../electron/owned-rpc.js';
import type { RpcLaunch } from '../electron/rpc-client.js';

class FakeRpc implements OwnedRpcTransport {
  alive = true;
  closeCount = 0;
  state: Record<string, any>;
  commands: { command: Record<string, any>; mutation: boolean }[] = [];
  listeners = new Set<(event: Record<string, any>) => void>();
  failure?: Error;
  constructor(sessionDir: string) { this.state = { sessionId: 'owned-id', sessionFile: join(sessionDir, 'owned.jsonl'), isStreaming: false, isCompacting: false }; }
  async request(command: Record<string, any>, mutation = true) {
    this.commands.push({ command, mutation });
    if (mutation && this.failure) throw this.failure;
    if (command.type === 'get_state') return { ...this.state };
    if (command.type === 'get_messages') return { messages: [{ role: 'user', content: 'own transcript' }] };
    if (command.type === 'get_available_models') return { models: [{ provider: 'provider', id: 'model', name: 'Model' }] };
    if (command.type === 'set_model') return { provider: command.provider, id: command.modelId };
    return undefined;
  }
  onEvent(listener: (event: Record<string, any>) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async close() { this.closeCount++; this.alive = false; }
}

async function fixture(run: (session: OwnedRpcSession, rpc: FakeRpc, launch: RpcLaunch) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'owned-rpc-test-'));
  let session: OwnedRpcSession | undefined;
  try {
    // launch canonicalizes /tmp to /private/tmp on macOS.
    let rpc!: FakeRpc;
    let launch!: RpcLaunch;
    session = await OwnedRpcSession.launch({ executable: '/fake/prime-agent', cwd: directory, sessionDir: directory, socketPath: '/custom/daemon.sock', model: 'provider/model', timeoutMs: 100 }, options => {
      launch = options;
      rpc = new FakeRpc(options.args[options.args.indexOf('--session-dir') + 1]);
      return rpc;
    });
    await run(session, rpc, launch);
  } finally { await session?.close(); await rm(directory, { recursive: true, force: true }); }
}

test('owned launch uses an intentional fresh RPC root and never navigates shared sessions', async () => {
  await fixture(async (session, rpc, launch) => {
    assert.deepEqual(launch.args, ['--mode', 'rpc', '--cwd', session.cwd, '--session-dir', session.cwd, '--no-extensions', '--daemon-socket', '/custom/daemon.sock', '--model', 'provider/model']);
    assert.equal(launch.env, undefined, 'credentials stay with the native inherited CLI configuration');
    assert.equal(session.id, 'owned-id');
    assert.equal(session.alive, true);
    assert.deepEqual(rpc.commands, [{ command: { type: 'get_state' }, mutation: false }]);
    const result = await session.refresh();
    assert.equal(result.messages[0].content, 'own transcript');
    assert.equal(result.state.sessionId, session.id);
    assert.ok(rpc.commands.every(({ command }) => !('activeSessionId' in command) && !('sessionId' in command)));
  });
});

test('prompt admission, follow-up queueing, abort, and models use a fixed command allowlist', async () => {
  await fixture(async (session, rpc) => {
    await session.send('hello');
    assert.deepEqual(rpc.commands.at(-1), { command: { type: 'prompt', message: 'hello', streamingBehavior: 'followUp' }, mutation: true });
    rpc.state.isStreaming = true;
    await session.send('next');
    assert.equal(rpc.commands.at(-1)?.command.streamingBehavior, 'followUp');
    await assert.rejects(session.setModel('provider', 'other'), /idle/);
    await session.abort();
    assert.equal(rpc.commands.at(-1)?.command.type, 'abort');
    rpc.state.isStreaming = false;
    rpc.state.unfinishedActionCount = 1;
    await assert.rejects(session.setModel('provider', 'other'), /idle/);
    rpc.state.unfinishedActionCount = 0;
    rpc.state.sessionActions = { queuedCount: 1 };
    await assert.rejects(session.setModel('provider', 'other'), /idle/);
    rpc.state.sessionActions.queuedCount = 0;
    assert.equal((await session.availableModels())[0].id, 'model');
    assert.equal((await session.setModel('provider', 'other')).id, 'other');
  });
});

test('slash commands and empty messages never reach RPC', async () => {
  await fixture(async (session, rpc) => {
    const before = rpc.commands.length;
    for (const message of ['/new', '  /resume anything', '\n/skill:unsafe', '  ']) await assert.rejects(session.send(message));
    assert.equal(rpc.commands.length, before);
  });
});

test('session identity mismatch freezes the owned pipe before a write', async () => {
  await fixture(async (session, rpc) => {
    rpc.state.sessionId = 'switched';
    await assert.rejects(session.send('never'), /identity changed/);
    assert.equal(session.alive, false);
    assert.equal(rpc.closeCount, 1);
    assert.ok(!rpc.commands.some(({ command }) => command.type === 'prompt'));
    await assert.rejects(session.abort(), /identity changed/);
    await session.close();
    assert.equal(rpc.closeCount, 1);
  });
});

test('transcript snapshot is rejected if the identity changes during the read', async () => {
  await fixture(async (session, rpc) => {
    const original = rpc.request.bind(rpc);
    rpc.request = async (command, mutation) => {
      const result = await original(command, mutation);
      if (command.type === 'get_messages') rpc.state.sessionId = 'other';
      return result;
    };
    await assert.rejects(session.refresh(), /identity changed/);
  });
});

test('uncertain admission closes without retry while an explicit rejection leaves the pipe usable', async () => {
  await fixture(async (session, rpc) => {
    rpc.failure = Error('No API key');
    await assert.rejects(session.send('first'), /No API key/);
    assert.equal(session.alive, true);
    rpc.failure = Error('RPC prompt timed out. Its outcome is uncertain.');
    await assert.rejects(session.send('second'), /uncertain/);
    assert.equal(session.alive, false);
    assert.equal(rpc.commands.filter(({ command }) => command.type === 'prompt').length, 2);
  });
});

test('unexpected extension dialog closes instead of granting extension capabilities', async () => {
  await fixture(async (session, rpc) => {
    for (const listener of rpc.listeners) listener({ type: 'extension_ui_request', id: 'dialog', method: 'confirm' });
    assert.equal(session.alive, false);
    assert.equal(rpc.commands.length, 1);
  });
});

test('invalid initial state or another storage directory closes the new process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'owned-rpc-invalid-'));
  try {
    for (const state of [{ sessionId: 'x' }, { sessionId: 'x', sessionFile: '/somewhere/else/file.jsonl', isStreaming: false, isCompacting: false }]) {
      const rpc = new FakeRpc(directory); rpc.state = state;
      await assert.rejects(OwnedRpcSession.launch({ executable: 'fake', cwd: directory, sessionDir: directory }, () => rpc));
      assert.equal(rpc.closeCount, 1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
