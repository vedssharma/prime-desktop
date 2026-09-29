import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, chmod } from 'node:fs/promises';
import { saveWorkspaceFile, listWorkspace, parseStatus, readWorkspaceFile, resolveInside, workspaceChanges, workspaceDiff, MAX_FILE_BYTES } from '../electron/workspace.js';

async function fixture() {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'dock-ws-')));
  const root = path.join(base, 'project'), outside = path.join(base, 'secret.txt');
  await mkdir(path.join(root, 'src'), { recursive: true }); await mkdir(path.join(root, '.git-not'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(root, 'README.md'), '# hi\n');
  await writeFile(outside, 'top secret');
  await symlink(outside, path.join(root, 'leak.txt'));
  await symlink(base, path.join(root, 'up'));
  return { base, root, cleanup: () => rm(base, { recursive: true, force: true }) };
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

test('paths must stay inside the workspace, including through symlinks', async () => {
  const { root, cleanup } = await fixture();
  try {
    assert.equal((await resolveInside(root, 'src/a.ts')).relative, 'src/a.ts');
    assert.equal((await resolveInside(root, '')).relative, '');
    for (const bad of ['../secret.txt', '/etc/passwd', 'src/../../secret.txt', 'leak.txt', 'up/secret.txt', 'a\0b', 'C:\\x'])
      await assert.rejects(resolveInside(root, bad), /workspace|Invalid|relative/, bad);
    await assert.rejects(resolveInside(root, 42), /Invalid/);
    await assert.rejects(readWorkspaceFile(root, 'leak.txt'), /outside/);
  } finally { await cleanup(); }
});

test('listing sorts folders first, hides .git and reports links without following them', async () => {
  const { root, cleanup } = await fixture();
  try {
    await mkdir(path.join(root, '.git'));
    const listing = await listWorkspace(root);
    assert.deepEqual(listing.entries.map(e => `${e.type}:${e.name}`), ['dir:.git-not', 'dir:src', 'link:leak.txt', 'file:README.md', 'link:up']);
    assert.deepEqual((await listWorkspace(root, 'src')).entries.map(e => e.name), ['a.ts']);
  } finally { await cleanup(); }
});

test('file preview handles text, binary and oversized files', async () => {
  const { root, cleanup } = await fixture();
  try {
    assert.deepEqual(await readWorkspaceFile(root, 'README.md'), { path: 'README.md', size: 5, binary: false, truncated: false, content: '# hi\n', editable: true, hash: createHash('sha256').update('# hi\n').digest('hex') });
    await writeFile(path.join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    const binary = await readWorkspaceFile(root, 'bin.dat');
    assert.equal(binary.binary, true); assert.equal(binary.content, '');
    await writeFile(path.join(root, 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 10));
    const big = await readWorkspaceFile(root, 'big.txt');
    assert.equal(big.truncated, true); assert.equal(big.content.length, MAX_FILE_BYTES);
    await assert.rejects(readWorkspaceFile(root, 'src'), /regular files/);
  } finally { await cleanup(); }
});

test('status parsing covers renames, untracked and NUL separation', () => {
  const output = ' M src/a.ts\0?? new file.txt\0R  new.ts\0old.ts\0D  gone.ts\0UU both.ts\0';
  assert.deepEqual(parseStatus(output).map(c => `${c.label}:${c.path}`), ['Modified:src/a.ts', 'Untracked:new file.txt', 'Renamed:new.ts', 'Deleted:gone.ts', 'Conflict:both.ts']);
});

test('non-repositories report isRepo false', async () => {
  const { root, cleanup } = await fixture();
  try { assert.equal((await workspaceChanges(root)).isRepo, false); } finally { await cleanup(); }
});

test('git changes and diffs cover modified, untracked and pre-commit repositories', async () => {
  const { root, cleanup } = await fixture();
  try {
    git(root, 'init', '-q');
    // Before the first commit there is no HEAD; everything staged or not still appears.
    git(root, 'add', 'README.md', 'src');
    assert.ok((await workspaceChanges(root)).changes.some(c => c.path === 'src/a.ts' && c.label === 'Added'));
    assert.match((await workspaceDiff(root, 'README.md')).diff, /\+# hi/);
    git(root, 'commit', '-q', '-m', 'init');
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 2;\n');
    await writeFile(path.join(root, 'fresh.txt'), 'brand new\n');
    const changes = await workspaceChanges(root);
    assert.equal(changes.isRepo, true);
    assert.ok(changes.changes.some(c => c.path === 'src/a.ts' && c.label === 'Modified'));
    assert.ok(changes.changes.some(c => c.path === 'fresh.txt' && c.label === 'Untracked'));
    const modified = await workspaceDiff(root, 'src/a.ts');
    assert.match(modified.diff, /-export const a = 1;/); assert.match(modified.diff, /\+export const a = 2;/);
    assert.match((await workspaceDiff(root, 'fresh.txt')).diff, /\+brand new/);
    await assert.rejects(workspaceDiff(root, '../x'), /Invalid/);
  } finally { await cleanup(); }
});

test('repository configuration cannot run an external diff program', async () => {
  const { root, cleanup } = await fixture();
  try {
    git(root, 'init', '-q'); git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'init');
    const marker = path.join(root, 'PWNED');
    await writeFile(path.join(root, '.git', 'config'), `[diff]\n\texternal = sh -c 'touch ${marker}'\n[core]\n\tfsmonitor = sh -c 'touch ${marker}'\n`, { flag: 'a' });
    await writeFile(path.join(root, 'README.md'), 'changed\n');
    await workspaceChanges(root); await workspaceDiff(root, 'README.md');
    await assert.rejects(readWorkspaceFile(root, 'PWNED'), /ENOENT/);
  } finally { await cleanup(); }
});

test('binary, truncated and non-UTF-8 files are not editable and carry no hash', async () => {
  const { root, cleanup } = await fixture();
  try {
    await writeFile(path.join(root, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    await writeFile(path.join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
    await writeFile(path.join(root, 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 1));
    for (const name of ['latin1.txt', 'bin.dat', 'big.txt']) {
      const file = await readWorkspaceFile(root, name);
      assert.equal(file.editable, false, name);
    }
    assert.equal((await readWorkspaceFile(root, 'bin.dat')).hash, undefined);
    await assert.rejects(saveWorkspaceFile(root, 'latin1.txt', 'x', 'a'.repeat(64), path.join(root, '..', 'bk')), /UTF-8/);
  } finally { await cleanup(); }
});

test('saving writes the new text, keeps a backup of the old bytes and preserves the file mode', async () => {
  const { base, root, cleanup } = await fixture();
  try {
    const backups = path.join(base, 'backups');
    await chmod(path.join(root, 'README.md'), 0o755);
    const before = await readWorkspaceFile(root, 'README.md');
    const saved = await saveWorkspaceFile(root, 'README.md', '# changed\n', before.hash, backups);
    assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), '# changed\n');
    assert.equal(saved.file.content, '# changed\n');
    assert.notEqual(saved.file.hash, before.hash);
    assert.equal(await readFile(saved.backup, 'utf8'), '# hi\n');
    assert.equal((await stat(path.join(root, 'README.md'))).mode & 0o777, 0o755);
    assert.equal((await stat(saved.backup)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), []);
    // Saving again with the fresh hash works; the old hash is now stale.
    await saveWorkspaceFile(root, 'README.md', 'third\n', saved.file.hash, backups);
    await assert.rejects(saveWorkspaceFile(root, 'README.md', 'fourth\n', before.hash, backups), /CHANGED_ON_DISK/);
    assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), 'third\n');
  } finally { await cleanup(); }
});

test('a file changed by someone else after it was opened is never overwritten', async () => {
  const { base, root, cleanup } = await fixture();
  try {
    const opened = await readWorkspaceFile(root, 'src/a.ts');
    await writeFile(path.join(root, 'src', 'a.ts'), 'agent wrote this\n');
    await assert.rejects(saveWorkspaceFile(root, 'src/a.ts', 'my edit', opened.hash, path.join(base, 'bk')), /changed on disk/);
    assert.equal(await readFile(path.join(root, 'src', 'a.ts'), 'utf8'), 'agent wrote this\n');
    await assert.rejects(stat(path.join(base, 'bk')), /ENOENT/, 'no backup for a save that did not happen');
  } finally { await cleanup(); }
});

test('saves reject escapes, bad hashes, NULs, oversize text and directories', async () => {
  const { base, root, cleanup } = await fixture();
  try {
    const hash = (await readWorkspaceFile(root, 'README.md')).hash;
    const bk = path.join(base, 'bk');
    await assert.rejects(saveWorkspaceFile(root, 'leak.txt', 'x', hash, bk), /outside/);
    await assert.rejects(saveWorkspaceFile(root, '../secret.txt', 'x', hash, bk), /outside/);
    await assert.rejects(saveWorkspaceFile(root, 'README.md', 'x', 'nope', bk), /Reload/);
    await assert.rejects(saveWorkspaceFile(root, 'README.md', 'a\0b', hash, bk), /text/);
    await assert.rejects(saveWorkspaceFile(root, 'README.md', 'x'.repeat(MAX_FILE_BYTES + 1), hash, bk), /text/);
    await assert.rejects(saveWorkspaceFile(root, 'README.md', 42, hash, bk), /text/);
    await assert.rejects(saveWorkspaceFile(root, 'src', 'x', hash, bk), /regular/);
    assert.equal(await readFile(path.join(base, 'secret.txt'), 'utf8'), 'top secret');
  } finally { await cleanup(); }
});

test('old backups are pruned to a bounded number', async () => {
  const { base, root, cleanup } = await fixture();
  try {
    const bk = path.join(base, 'bk');
    await mkdir(bk);
    for (let i = 0; i < 205; i++) await writeFile(path.join(bk, `0000-${String(i).padStart(4, '0')}-old`), 'x');
    const opened = await readWorkspaceFile(root, 'README.md');
    await saveWorkspaceFile(root, 'README.md', 'new', opened.hash, bk);
    const names = await readdir(bk);
    assert.equal(names.length, 200);
    assert.ok(!names.includes('0000-0000-old'));
  } finally { await cleanup(); }
});
