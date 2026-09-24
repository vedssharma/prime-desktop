import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { JsonlDecoder, readBoundedFile } from '../electron/bounded-io.js';
import { DaemonTransport } from '../electron/transport.js';
import { parseSavedTranscript } from '../electron/prime.js';

test('JSONL byte bound handles multibyte and split UTF8 correctly', () => {
  const lines: string[] = []; const decoder = new JsonlDecoder(8);
  const bytes = Buffer.from('"☃"\n'); decoder.feed(bytes.subarray(0, 2), line => lines.push(line)); decoder.feed(bytes.subarray(2), line => lines.push(line));
  assert.deepEqual(lines, ['"☃"']);
  assert.throws(() => new JsonlDecoder(5).feed(Buffer.from('☃☃\n'), () => {}), /byte limit/);
  assert.throws(() => new JsonlDecoder(5).feed(Buffer.from('123456'), () => {}), /byte limit/);
});

test('bounded file reads reject oversize regular files and invalid saved records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bound-')); const file = join(dir, 'file');
  try { await writeFile(file, '12345'); assert.equal(await readBoundedFile(file, 5), '12345'); await assert.rejects(readBoundedFile(file, 4), /byte limit/); for (const value of ['null', '[]', '42']) assert.throws(() => parseSavedTranscript(value + '\n'), /invalid record/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('scalar and malformed daemon records fail connection without crashing', async () => {
  for (const payload of ['null', '[]', '42', '{broken}', '{"type":"response","id":4,"success":true}']) {
    const dir = await mkdtemp(join(tmpdir(), 'frame-')); const socketPath = join(dir, 's');
    const server = createServer(socket => { socket.on('error', () => {}); socket.end(payload + '\n'); });
    await new Promise<void>(resolve => server.listen(socketPath, resolve)); const client = new DaemonTransport(socketPath, 500);
    try { await assert.rejects(client.connect(), /Invalid/); }
    finally { client.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
  }
});
