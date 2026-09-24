import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
export const MAX_BYTES = 64 * 1024 * 1024;
/** LF-delimited UTF-8, bounded before concatenation or decoding. */
export class JsonlDecoder {
  private parts: Buffer[] = [];
  private size = 0;
  constructor(private maxBytes = MAX_BYTES) {}
  feed(chunk: Buffer, onLine: (line: string) => void): void {
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, end < 0 ? chunk.length : end);
      if (this.size + part.length > this.maxBytes) { this.parts = []; this.size = 0; throw new Error('Prime Agent response exceeds the byte limit.'); }
      this.parts.push(part); this.size += part.length;
      if (end < 0) return;
      const line = Buffer.concat(this.parts, this.size).toString('utf8').replace(/\r$/, '');
      this.parts = []; this.size = 0;
      if (line) onLine(line);
      offset = end + 1;
    }
  }
}
export async function readBoundedFile(path: string, maxBytes = MAX_BYTES): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Transcript must be a regular file.');
    if (stat.size > maxBytes) throw new Error('Saved transcript exceeds the byte limit. Open it in the CLI.');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      // One extra byte detects growth past the bound without allocating an unbounded file.
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - size + 1));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maxBytes) throw new Error('Saved transcript grew beyond the byte limit.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally { await file.close(); }
}
export function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
