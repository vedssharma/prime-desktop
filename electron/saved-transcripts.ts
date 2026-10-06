import { stat } from 'node:fs/promises';
import { readBoundedFile } from './bounded-io.js';
import type { WireRecord } from './transport.js';
import { normalizeMessages, parseSavedTranscript, type Message } from './transcript.js';

/**
 * Saved transcripts read from disk, with a least-recently-used cache. `full` decides when to
 * evict, from the entry count and approximate bytes held.
 */
export class SavedTranscripts {
  private cache = new Map<string, { key: string; messages: Message[]; size: number }>();
  constructor(private readonly full: (entries: number, bytes: number) => boolean) {}
  /**
   * Parse a saved transcript after checking its header names the expected session. Results are
   * cached by file identity, size and timestamps, so an unchanged file is never re-read.
   */
  async read(id: string, file: unknown, expectedId: string): Promise<Message[]> {
    const cache = this.cache;
    if (typeof file !== 'string' || !file) throw new Error('This session has no saved transcript. Open it in the CLI.');
    const metadata = await stat(file);
    const cacheKey = JSON.stringify([file, metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs]);
    const hit = cache.get(id);
    if (hit?.key === cacheKey) { cache.delete(id); cache.set(id, hit); return hit.messages; }
    if (metadata.size > 64 * 1024 * 1024) throw new Error('This saved transcript exceeds the 64 MiB desktop limit. Open it in the CLI.');
    const contents = await readBoundedFile(file);
    let header: WireRecord;
    try { header = JSON.parse(contents.split('\n', 1)[0]); }
    catch { throw new Error('Invalid saved session header.'); }
    if (header?.type !== 'session' || header.id !== expectedId) throw new Error('Session identity mismatch. Refusing to display another conversation.');
    if (contents.split('\n').slice(1).some(line => { try { return JSON.parse(line)?.type === 'session'; } catch { return false; } })) throw new Error('Multiple session headers. Refusing an ambiguous transcript.');
    const messages = normalizeMessages(parseSavedTranscript(contents));
    cache.delete(id);
    cache.set(id, { key: cacheKey, messages, size: messages.reduce((total, message) => total + message.content.length * 2, 0) });
    let bytes = [...cache.values()].reduce((total, item) => total + item.size, 0);
    // Least recently used first; always keep the transcript just read.
    for (const [oldest, item] of cache) {
      if (cache.size <= 1 || !this.full(cache.size, bytes)) break;
      cache.delete(oldest); bytes -= item.size;
    }
    return messages;
  }
  forget(id: string) { this.cache.delete(id); }
}
