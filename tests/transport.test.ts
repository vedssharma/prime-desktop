import test from 'node:test';
import assert from 'node:assert/strict';
import { DaemonTransport } from '../electron/transport.js';
import { fakeDaemon } from './fake-daemon.js';

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
