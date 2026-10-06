/**
 * Pure mapping from Prime Agent wire records and saved JSONL transcripts to the desktop's
 * Session and Message shapes. No I/O; PrimeService (prime.ts) owns reading and caching.
 */
import type { WireRecord } from './transport.js';
import { isRecord } from './bounded-io.js';
import { validateImages, type ImageAttachment } from './attachments.js';

export interface Session { archived?: boolean; supportsImages?: boolean; queuedCount?: number; id: string; title: string; cwd: string; model: string; status: 'idle' | 'running' | 'error'; updatedAt: string; createdAt: string; ownership?: 'shared' | 'desktop'; writable?: boolean; lifecycle?: 'open' | 'closed'; }
export interface Message { id: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; timestamp?: string; toolName?: string; images?: ImageAttachment[]; diff?: string; }

/** A short single-line excerpt centered on the first match. */
export function snippetAround(content: string, index: number, length: number, radius = 48): string {
  const start = Math.max(0, index - radius), end = Math.min(content.length, index + length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '…' : ''}`;
}

export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function date(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? undefined : result.toISOString();
}
export function normalizeSession(raw: WireRecord): Session {
  return {
    id: text(raw.sessionId) || text(raw.id),
    title: text(raw.sessionName) || text(raw.name) || text(raw.firstMessage) || 'Untitled session',
    cwd: text(raw.cwd), model: text(raw.model?.name) || text(raw.model?.id),
    status: raw.workerState === 'failed' || raw.rosterStatus === 'error' ? 'error' : raw.isStreaming || raw.isCompacting || raw.isBashRunning || raw.hasRunningRlmChildren || raw.activity === 'working' ? 'running' : 'idle',
    updatedAt: date(raw.lastActivityAt) || date(raw.modified) || date(raw.created) || new Date(0).toISOString(),
    createdAt: date(raw.created) || new Date(0).toISOString(),
  };
}

/**
 * Live RPC messages have no IDs. Derive them from role and timestamp, not list position, so a
 * streamed reply keeps the same ID (and React key) once it lands in a full transcript read.
 */
export function fallbackId(message: WireRecord, index: number, seen: Map<string, number>): string {
  if (message.timestamp === undefined || message.timestamp === null) return `${message.role}-${index}-${index}`;
  const key = `${message.role}-${message.timestamp}`;
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  return count === 1 ? key : `${key}-${count}`;
}

/** Largest edit diff passed to the renderer; bigger ones show as plain tool output. */
const MAX_TOOL_DIFF_CHARS = 256 * 1024;

/** The diff a successful edit tool result reports in `details.diff`. */
function appliedDiff(message: WireRecord): string | undefined {
  if (message.role !== 'toolResult' || message.isError === true || !isRecord(message.details)) return undefined;
  const diff = message.details.diff;
  return typeof diff === 'string' && diff && diff.length <= MAX_TOOL_DIFF_CHARS ? diff : undefined;
}

export function normalizeMessages(messages: WireRecord[]): Message[] {
  const output: Message[] = [];
  const seen = new Map<string, number>();
  messages.forEach((message, index) => {
    const id = text(message.id) || fallbackId(message, index, seen);
    const timestamp = date(message.timestamp);
    if (message.role === 'custom' && message.display === false) return;
    const role: Message['role'] = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : ['toolResult', 'bashExecution'].includes(message.role) ? 'tool' : 'system';
    const blocks: WireRecord[] = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
    let content = typeof message.content === 'string' ? message.content : blocks.filter(block => block.type === 'text').map(block => text(block.text)).join('\n');
    if (['branchSummary', 'compactionSummary'].includes(message.role)) content = `${message.role === 'branchSummary' ? 'Branch summary' : 'Context summary'}\n\n${text(message.summary)}`;
    if (message.role === 'bashExecution') content = `$ ${text(message.command)}\n${text(message.output)}`;
    if (message.errorMessage) content += `${content ? '\n\n' : ''}Error: ${message.errorMessage}`;
    const images: ImageAttachment[] = [];
    for (const block of blocks.filter(block => block.type === 'image')) {
      try { validateImages([...images, block]); images.push(validateImages([block])[0]); }
      catch { content += '\n[Image attachment unavailable: unsupported type or size]'; }
    }
    const diff = appliedDiff(message);
    if (content.trim() || images.length) output.push({ id, role, content, timestamp, ...(images.length ? { images } : {}), ...(message.toolName ? { toolName: text(message.toolName) } : {}), ...(diff ? { diff } : {}) });
    blocks.filter(block => block.type === 'toolCall').forEach((block, i) => {
      output.push({ id: `${id}-call-${i}`, role: 'tool', toolName: text(block.name), timestamp, content: JSON.stringify(block.arguments ?? {}, null, 2) });
    });
  });
  return output;
}

/** Read the selected JSONL branch without opening/migrating/waking a saved worker. */
export function parseSavedTranscript(contents: string): WireRecord[] {
  const entries: WireRecord[] = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let entry: unknown;
    try { entry = JSON.parse(lines[i]); } catch { if (i !== lines.length - 1) throw new Error('Saved transcript contains invalid JSON.'); else continue; }
    if (!isRecord(entry) || typeof entry.type !== 'string') throw new Error('Saved transcript contains an invalid record.');
    entries.push(entry);
  }
  const nodes = entries.filter(entry => typeof entry.id === 'string' && entry.type !== 'session');
  const byId = new Map(nodes.map(entry => [entry.id, entry]));
  const branch: WireRecord[] = [];
  let cursor = nodes.at(-1);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  // Old v1 transcripts are linear and do not contain tree parent links.
  const tree = nodes.some(entry => 'parentId' in entry);
  // Display the selected history branch, not just the provider's compacted context.
  return (tree ? branch.reverse() : entries).flatMap(entry => {
    if (entry.type === 'message' && entry.message) return [{ ...entry.message, id: entry.id }];
    if (entry.type === 'custom_message') return [{ role: 'custom', content: entry.content, display: entry.display, timestamp: entry.timestamp, id: entry.id }];
    if (entry.type === 'branch_summary' || entry.type === 'compaction') return [{ role: entry.type === 'branch_summary' ? 'branchSummary' : 'compactionSummary', summary: entry.summary, timestamp: entry.timestamp, id: entry.id }];
    return [];
  });
}
