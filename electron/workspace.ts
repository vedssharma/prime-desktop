import { execFile } from 'node:child_process';
import { chmod, mkdir, open, lstat, readdir, realpath, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import path from 'node:path';

/**
 * Read-only views of a session's workspace. Every path is resolved against the session's own
 * directory and must stay inside it after symlinks are resolved. This is a UI convenience,
 * not a sandbox: agent tools themselves are not confined to this directory.
 */
export const MAX_ENTRIES = 1000;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_DIFF_BYTES = 1024 * 1024;
const HIDDEN = new Set(['.git']);

export interface WorkspaceEntry { name: string; type: 'file' | 'dir' | 'link'; size: number }
export interface WorkspaceListing { path: string; entries: WorkspaceEntry[]; truncated: boolean }
export interface WorkspaceFile { path: string; size: number; binary: boolean; truncated: boolean; content: string; /** SHA-256 of the exact bytes read; only for complete text files. */ hash?: string; editable: boolean }
export interface WorkspaceSaveResult { file: WorkspaceFile; backup: string }
export interface WorkspaceChange { path: string; status: string; label: string }
export interface WorkspaceChanges { isRepo: boolean; changes: WorkspaceChange[]; truncated: boolean; error?: string }
export interface WorkspaceDiff { path: string; diff: string; truncated: boolean }

/** Resolve a workspace-relative path; reject absolute paths, traversal, NULs, and symlink escapes. */
export async function resolveInside(root: string, relative: unknown): Promise<{ root: string; full: string; relative: string }> {
  if (typeof relative !== 'string' || relative.length > 4096 || relative.includes('\0')) throw new Error('Invalid workspace path.');
  if (path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) throw new Error('Workspace paths must be relative.');
  const realRoot = await realpath(root);
  const candidate = path.resolve(realRoot, relative);
  const inside = (base: string, target: string) => { const rel = path.relative(base, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  if (!inside(realRoot, candidate)) throw new Error('Path is outside the workspace.');
  const real = await realpath(candidate);
  if (!inside(realRoot, real)) throw new Error('Path is outside the workspace.');
  return { root: realRoot, full: real, relative: path.relative(realRoot, real).split(path.sep).join('/') };
}

export async function listWorkspace(root: string, relative = ''): Promise<WorkspaceListing> {
  const target = await resolveInside(root, relative);
  const names = await readdir(target.full);
  const entries: WorkspaceEntry[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (HIDDEN.has(name)) continue;
    if (entries.length >= MAX_ENTRIES) return { path: target.relative, entries: sortEntries(entries), truncated: true };
    try {
      const info = await lstat(path.join(target.full, name));
      entries.push({ name, type: info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'dir' : 'file', size: info.isFile() ? info.size : 0 });
    } catch { /* Vanished between readdir and lstat. */ }
  }
  return { path: target.relative, entries: sortEntries(entries), truncated: false };
}
const sortEntries = (entries: WorkspaceEntry[]) => entries.sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name));

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Text that survives a UTF-8 decode/encode round trip byte-for-byte can be edited without corruption. */
const roundTrips = (bytes: Buffer) => Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
function describe(relative: string, size: number, bytes: Buffer): WorkspaceFile {
  const truncated = size > MAX_FILE_BYTES;
  const binary = bytes.subarray(0, 8000).includes(0);
  const complete = !truncated && !binary;
  return { path: relative, size, binary, truncated, content: binary ? '' : bytes.toString('utf8'), editable: complete && roundTrips(bytes), ...(complete ? { hash: sha256(bytes) } : {}) };
}

export async function readWorkspaceFile(root: string, relative: string): Promise<WorkspaceFile> {
  const target = await resolveInside(root, relative);
  // O_NONBLOCK keeps a FIFO from hanging the read; only regular files are returned.
  const handle = await open(target.full, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Only regular files can be previewed.');
    const buffer = Buffer.alloc(Math.min(info.size, MAX_FILE_BYTES));
    const { bytesRead } = buffer.length ? await handle.read(buffer, 0, buffer.length, 0) : { bytesRead: 0 };
    return describe(target.relative, info.size, buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

const MAX_BACKUPS = 200;
/**
 * Save an edit to an existing text file. The caller passes the hash it last read; if the file
 * changed on disk since (for example, the agent wrote to it), nothing is written. The previous
 * bytes are copied to `backupDir` first. The check and the write are not one atomic step, so
 * a change landing in that instant can still be overwritten, but the backup keeps it recoverable.
 */
export async function saveWorkspaceFile(root: string, relative: string, content: unknown, expectedHash: unknown, backupDir: string): Promise<WorkspaceSaveResult> {
  if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('File content must be text of at most 512 KiB.');
  if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error('Reload the file before saving.');
  const target = await resolveInside(root, relative);
  const info = await lstat(target.full);
  if (!info.isFile()) throw new Error('Only regular files can be edited.');
  if (info.size > MAX_FILE_BYTES) throw new Error('This file is too large to edit here.');
  const current = await readFile(target.full);
  if (current.subarray(0, 8000).includes(0) || !roundTrips(current)) throw new Error('This file is not valid UTF-8 text and cannot be edited here.');
  if (sha256(current) !== expectedHash) throw new Error('CHANGED_ON_DISK: This file changed on disk after you opened it. Reload it to see the new contents; your edit was not saved.');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(backupDir, `${stamp}-${expectedHash.slice(0, 8)}-${path.basename(target.full).replace(/[^\w.-]/g, '_')}`);
  await writeFile(backup, current, { mode: 0o600, flag: 'wx' });
  const temporary = `${target.full}.dock-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await chmod(temporary, info.mode & 0o7777);
    await rename(temporary, target.full);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  const names = (await readdir(backupDir)).sort();
  for (const old of names.slice(0, Math.max(0, names.length - MAX_BACKUPS))) await rm(path.join(backupDir, old), { force: true });
  return { file: await readWorkspaceFile(root, relative), backup };
}

// Never let repository-controlled configuration run programs: no fsmonitor, no external diff or textconv.
const GIT_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'diff.external=', '--no-pager'];
function git(cwd: string, args: string[], maxBuffer = MAX_DIFF_BYTES + 1024): Promise<{ stdout: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    execFile('git', [...GIT_ARGS, ...args], { cwd, timeout: 15_000, maxBuffer, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } }, (error, stdout) => {
      const failure = error as (NodeJS.ErrnoException & { code?: string | number }) | null;
      if (failure?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ stdout: String(stdout), truncated: true });
      if (failure) return reject(Object.assign(failure, { stdout }));
      resolve({ stdout, truncated: false });
    });
  });
}

const statusLabel = (code: string) => code === '??' ? 'Untracked' : code.includes('U') || code === 'AA' || code === 'DD' ? 'Conflict' : code.includes('R') ? 'Renamed' : code.includes('D') ? 'Deleted' : code.includes('A') ? 'Added' : 'Modified';
export function parseStatus(output: string): WorkspaceChange[] {
  const parts = output.split('\0');
  const changes: WorkspaceChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (record.length < 4) continue;
    const code = record.slice(0, 2), file = record.slice(3);
    if (code.includes('R') || code.includes('C')) i++; // Rename/copy records are followed by the original path.
    changes.push({ path: file, status: code.trim() || '?', label: statusLabel(code) });
  }
  return changes;
}

export async function workspaceChanges(root: string): Promise<WorkspaceChanges> {
  const real = await realpath(root);
  try {
    const inside = (await git(real, ['rev-parse', '--is-inside-work-tree'])).stdout.trim();
    if (inside !== 'true') return { isRepo: false, changes: [], truncated: false };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { isRepo: false, changes: [], truncated: false, ...(missing ? { error: 'Git is not installed or not on PATH.' } : {}) };
  }
  const { stdout, truncated } = await git(real, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const changes = parseStatus(stdout);
  return { isRepo: true, changes: changes.slice(0, MAX_ENTRIES), truncated: truncated || changes.length > MAX_ENTRIES };
}

export async function workspaceDiff(root: string, relative: string): Promise<WorkspaceDiff> {
  const real = await realpath(root);
  const rel = path.relative(real, path.resolve(real, relative)).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || relative.includes('\0')) throw new Error('Invalid workspace path.');
  const flags = ['--no-color', '--no-ext-diff', '--no-textconv'];
  let head = true;
  try { await git(real, ['rev-parse', '--verify', 'HEAD']); } catch { head = false; }
  // Before the first commit there is no HEAD, so staged content is the baseline.
  const tracked = await git(real, ['diff', ...flags, ...(head ? ['HEAD'] : ['--cached']), '--', rel]);
  if (tracked.stdout.trim()) return { path: rel, ...cap(tracked) };
  // Untracked files have no diff against HEAD; --no-index against /dev/null shows them as new.
  try { await git(real, ['diff', ...flags, '--no-index', '--', '/dev/null', rel]); return { path: rel, diff: '', truncated: false }; }
  catch (error) {
    const out = (error as { stdout?: string }).stdout;
    if (typeof out === 'string' && out) return { path: rel, ...cap({ stdout: out, truncated: false }) };
    throw error;
  }
}
const cap = ({ stdout, truncated }: { stdout: string; truncated: boolean }) => stdout.length > MAX_DIFF_BYTES ? { diff: stdout.slice(0, MAX_DIFF_BYTES), truncated: true } : { diff: stdout, truncated };
