import test from 'node:test';
import assert from 'node:assert/strict';
import { DaemonTransport } from '../electron/transport.js';
import { fakeDaemon } from './fake-daemon.js';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('LF JSONL preserves Unicode separators and correlates concurrent envelopes', async () => {
  const daemon = await fakeDaemon(command => ({ value: command.value }));
  const client = new DaemonTransport(daemon.socketPath);
  try {
    assert.equal((await client.connect()).protocol.version, 7);
    const results = await Promise.all([client.request({ type: 'get_state', value: 'a\u2028b\u2029c ☃' }), client.request({ type: 'list', value: 'second' })]);
    assert.equal(results[0].value, 'a\u2028b\u2029c ☃');
    assert.equal(results[1].value, 'second');
    assert.equal(daemon.envelopes[0].clientId, daemon.envelopes[1].clientId);
    assert.equal(daemon.envelopes[0].protocol.name, 'prime-agent.daemon');
    assert.notEqual(daemon.envelopes[0].id, daemon.envelopes[1].id);
  } finally { client.close(); await daemon.close(); }
});

test('unsupported protocol and old schema fail before a command is sent', async () => {
  for (const hello of [{ protocol: { name: 'prime-agent.daemon', version: 4 } }, { schemaRevision: 27 }]) {
    const daemon = await fakeDaemon(undefined, hello);
    const client = new DaemonTransport(daemon.socketPath);
    try {
      await assert.rejects(client.request({ type: 'create' }), /Unsupported Prime Agent/);
      assert.deepEqual(daemon.commands, []);
    } finally { client.close(); await daemon.close(); }
  }
});

test('mutation outcomes are acknowledged; errors are surfaced', async () => {
  const daemon = await fakeDaemon(command => { if (command.type === 'rename') throw new Error('name unavailable'); return {}; });
  const client = new DaemonTransport(daemon.socketPath);
  try {
    await client.request({ type: 'abort' });
    await assert.rejects(client.request({ type: 'rename' }), /name unavailable/);
    await client.request({ type: 'list' });
    assert.equal(daemon.commands.filter(c => c.type === 'ack_result').length, 2);
  } finally { client.close(); await daemon.close(); }
});

test('disconnect rejects uncertain mutation without retrying it', async () => {
  const daemon = await fakeDaemon(() => 'disconnect');
  const client = new DaemonTransport(daemon.socketPath);
  try {
    await assert.rejects(client.request({ type: 'create' }), /outcome is uncertain/);
    assert.equal(daemon.commands.filter(c => c.type === 'create').length, 1);
  } finally { client.close(); await daemon.close(); }
});

test('requests have bounded timeouts', async () => {
  const daemon = await fakeDaemon(() => 'no_response');
  const client = new DaemonTransport(daemon.socketPath);
  try { await assert.rejects(client.request({ type: 'list' }, 30), /timed out/); }
  finally { client.close(); await daemon.close(); }
});

test('closing a retired socket does not reject replacement connection requests', async () => {
  const daemon = await fakeDaemon(command => ({ value: command.value }));
  const client = new DaemonTransport(daemon.socketPath);
  try {
    await client.connect();
    client.close();
    const result = await client.request({ type: 'list', value: 'new transport' });
    assert.equal(result.value, 'new transport');
    assert.equal(client.connected, true);
  } finally { client.close(); await daemon.close(); }
});

const HELLO = JSON.stringify({ type: 'daemon_hello', protocol: { name: 'prime-agent.daemon', version: 7 }, schemaRevision: 28 });
async function rawDaemon(payload: string | null) {
  const directory = await mkdtemp(join(tmpdir(), 'raw-daemon-'));
  const socketPath = join(directory, 'daemon.sock');
  const sockets = new Set<Socket>(); let connections = 0;
  const server = createServer(socket => { connections++; sockets.add(socket); socket.on('error', () => {}); if (payload !== null) socket.write(payload); });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  return { socketPath, connections: () => connections, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}

test('prompts require the admission capability and are refused before anything is sent', async () => {
  const daemon = await fakeDaemon(undefined, { serverCapabilities: ['other'] });
  const client = new DaemonTransport(daemon.socketPath);
  try {
    await assert.rejects(client.request({ type: 'prompt', message: 'no' }), /does not support session prompt admission/);
    assert.deepEqual(daemon.commands, []);
  } finally { client.close(); await daemon.close(); }
});

test('malformed handshakes and responses fail the connection', async () => {
  for (const [payload, pattern] of [
    [JSON.stringify({ type: 'daemon_hello', protocol: { name: 'prime-agent.daemon', version: 7 }, schemaRevision: 28, serverCapabilities: 'all' }) + '\n', /Invalid daemon capabilities/],
    [JSON.stringify({ type: 'daemon_hello', protocol: { name: 'prime-agent.daemon', version: 7 }, schemaRevision: 28, serverCapabilities: [1] }) + '\n', /Invalid daemon capabilities/],
    [JSON.stringify({ type: 'daemon_hello', protocol: { name: 'other', version: 7 }, schemaRevision: 28 }) + '\n', /Unsupported Prime Agent daemon/],
    [JSON.stringify({ type: 'daemon_hello', protocol: { name: 'prime-agent.daemon', version: 7 }, schemaRevision: 28.5 }) + '\n', /Unsupported Prime Agent daemon/],
    [JSON.stringify({ type: 'response', id: 'early', success: true }) + '\n', /Invalid daemon response/],
  ] as const) {
    const daemon = await rawDaemon(payload); const client = new DaemonTransport(daemon.socketPath, 1000);
    try { await assert.rejects(client.connect(), pattern, payload); assert.equal(client.connected, false); }
    finally { client.close(); await daemon.close(); }
  }
});

test('a duplicate handshake or a non-object response payload drops the connection', async () => {
  for (const extra of [HELLO, JSON.stringify({ type: 'response', id: 'x', success: true, data: [1] }), JSON.stringify({ type: 'response', id: 'x', success: false, error: 5 })]) {
    const daemon = await rawDaemon(HELLO + '\n' + extra + '\n'); const client = new DaemonTransport(daemon.socketPath, 1000);
    try {
      await client.connect();
      for (let i = 0; i < 200 && client.connected; i++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(client.connected, false, extra);
    } finally { client.close(); await daemon.close(); }
  }
});

test('a silent daemon times out the handshake and concurrent connects share one socket', async () => {
  const silent = await rawDaemon(null); const slow = new DaemonTransport(silent.socketPath, 50);
  try { await assert.rejects(slow.connect(), /Timed out waiting for the Prime Agent daemon handshake/); }
  finally { slow.close(); await silent.close(); }
  const daemon = await rawDaemon(HELLO + '\n'); const client = new DaemonTransport(daemon.socketPath);
  try {
    const first = client.connect(); const second = client.connect();
    assert.equal(first, second);
    await first; await client.connect();
    assert.equal(daemon.connections(), 1);
  } finally { client.close(); await daemon.close(); }
});

test('closing the transport rejects requests that are still waiting', async () => {
  const daemon = await fakeDaemon(() => 'no_response');
  const client = new DaemonTransport(daemon.socketPath);
  try {
    const pending = client.request({ type: 'list' });
    while (!daemon.commands.length) await new Promise(resolve => setTimeout(resolve, 5));
    client.close();
    await assert.rejects(pending, /Desktop connection closed/);
    assert.equal(client.connected, false);
  } finally { client.close(); await daemon.close(); }
});
