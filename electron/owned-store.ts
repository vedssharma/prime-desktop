import { mkdir, readdir, realpath, writeFile, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { isRecord, readBoundedFile } from './bounded-io.js';
import { randomUUID } from 'node:crypto';
export interface OwnedMetadata {
  id: string; sessionId: string; sessionFile: string; title: string; cwd: string; model: string; createdAt: string; updatedAt: string;
}
const validId = (id: string) => /^desktop-[0-9a-f-]{36}$/.test(id);
export class OwnedStore {
  private writes = new Map<string, Promise<void>>();
  constructor(public directory: string) {}
  get transcripts() { return join(this.directory, 'transcripts'); }
  async initialize() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await mkdir(this.transcripts, { recursive: true, mode: 0o700 }); this.directory = await realpath(this.directory); }
  private validate(value: unknown): OwnedMetadata {
    if (!isRecord(value) || !['id', 'sessionId', 'sessionFile', 'title', 'cwd', 'model', 'createdAt', 'updatedAt'].every(key => typeof value[key] === 'string') || !validId(value.id)) throw Error('Invalid desktop session metadata');
    const child = relative(resolve(this.transcripts), resolve(value.sessionFile));
    if (child.startsWith('..') || isAbsolute(child) || !value.sessionId || !isAbsolute(value.cwd)) throw Error('Invalid desktop transcript location');
    return value as OwnedMetadata;
  }
  async list(): Promise<OwnedMetadata[]> {
    await this.initialize(); const items: OwnedMetadata[] = [];
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith('.json') || !validId(name.slice(0, -5))) continue;
      const file = join(this.directory, name);
      // Corrupt individual metadata must not hide every other conversation.
      try { const value = this.validate(JSON.parse(await readBoundedFile(file, 32 * 1024))); if (value.id + '.json' === name) items.push(value); } catch { /* Not a valid desktop record. */ }
    }
    return items;
  }
  async save(value: OwnedMetadata) {
    const snapshot = { ...value }; this.validate(snapshot);
    const previous = this.writes.get(value.id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      await this.initialize();
      const file = join(this.directory, snapshot.id + '.json');
      const temporary = file + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 }); await rename(temporary, file);
    });
    this.writes.set(value.id, task);
    try { await task; } finally { if (this.writes.get(value.id) === task) this.writes.delete(value.id); }
  }
}
