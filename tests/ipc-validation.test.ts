import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory, text, validateConfig } from '../electron/ipc-validation.js';

test('renderer text arguments must be non-blank bounded strings without NUL', () => {
  assert.equal(text('  keep surrounding space ', 'title'), '  keep surrounding space ');
  assert.equal(text('x'.repeat(10), 'title', 10), 'x'.repeat(10));
  for (const value of [undefined, null, 42, {}, ['id'], '', '   \n', 'a\0b', 'x'.repeat(11)]) {
    assert.throws(() => text(value, 'title', 10), /^Error: Invalid title$/, JSON.stringify(value));
  }
  assert.throws(() => text('x'.repeat(100_001), 'message'), /Invalid message/);
});

test('connection settings accept empty defaults and trimmed absolute paths only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipc-config-'));
  const cli = join(dir, 'prime-agent'); const plain = join(dir, 'plain');
  try {
    await writeFile(cli, '#!/bin/sh\n'); await chmod(cli, 0o700);
    await writeFile(plain, ''); await chmod(plain, 0o600);
    assert.deepEqual(await validateConfig({ executable: '', socketPath: '  ' }), { executable: '', socketPath: '' });
    assert.deepEqual(await validateConfig({ executable: ` ${cli} `, socketPath: ' /tmp/custom.sock ', extra: 'ignored' }), { executable: cli, socketPath: '/tmp/custom.sock' });
    for (const value of [null, 'string', 42]) await assert.rejects(validateConfig(value), /Invalid connection settings/);
    for (const [value, pattern] of [
      [{ socketPath: '' }, /Invalid executable/],
      [{ executable: '', socketPath: 7 }, /Invalid socketPath/],
      [{ executable: '/bin/\0sh', socketPath: '' }, /Invalid executable/],
      [{ executable: '', socketPath: '/' + 'x'.repeat(4096) }, /Invalid socketPath/],
      [{ executable: 'prime-agent', socketPath: '' }, /executable must be an absolute path/],
      [{ executable: '', socketPath: 'daemon.sock' }, /socketPath must be an absolute path/],
      [{ executable: dir, socketPath: '' }, /CLI must be a file/],
      [{ executable: join(dir, 'missing'), socketPath: '' }, /ENOENT/],
    ] as const) await assert.rejects(validateConfig(value), pattern, JSON.stringify(value));
    if (process.getuid?.() !== 0) await assert.rejects(validateConfig({ executable: plain, socketPath: '' }), /EACCES/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('workspace directories must exist, be absolute, and not be files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipc-directory-'));
  const file = join(dir, 'file');
  try {
    await writeFile(file, '');
    assert.equal(await directory(dir), dir);
    await assert.rejects(directory('relative/dir'), /existing absolute directory/);
    await assert.rejects(directory(file), /existing absolute directory/);
    await assert.rejects(directory(join(dir, 'missing')), /ENOENT/);
    await assert.rejects(directory(42), /Invalid directory/);
    await assert.rejects(directory('/' + 'x'.repeat(4096)), /Invalid directory/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
