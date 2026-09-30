import { isRecord } from './bounded-io.js';

/** Retain the selected branch through a real message, never mutate the source file. */
export function historyThroughMessage(contents: string, entryId: string): string {
  if (typeof entryId !== 'string' || !entryId || entryId.length > 256) throw Error('Invalid fork message ID.');
  const records = contents.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as unknown);
  if (!records.every(isRecord)) throw Error('Invalid saved history.');
  const header = records[0];
  if (header?.type !== 'session' || header.version !== 3) throw Error('Earlier-message forks require version 3 saved history.');
  const entries = records.slice(1);
  const nodes = new Map<string, Record<string, any>>();
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || nodes.has(entry.id) || !('parentId' in entry)) throw Error('Ambiguous saved history.');
    nodes.set(entry.id, entry);
  }
  const branch: Record<string, any>[] = [];
  const seen = new Set<string>();
  let cursor = entries.at(-1);
  while (cursor) {
    if (seen.has(cursor.id)) throw Error('Cyclic saved history.');
    seen.add(cursor.id); branch.push(cursor);
    if (cursor.parentId === null) break;
    if (typeof cursor.parentId !== 'string' || !nodes.has(cursor.parentId)) throw Error('Broken saved history branch.');
    cursor = nodes.get(cursor.parentId);
  }
  branch.reverse();
  const index = branch.findIndex(entry => entry.id === entryId);
  if (index < 0 || branch[index].type !== 'message' || !isRecord(branch[index].message) || !['user', 'assistant'].includes(branch[index].message.role)) throw Error('Select a user or assistant message from the current saved branch.');
  // An assistant tool call needs its results; disallow cutting in the middle of a tool turn.
  const selected = branch[index];
  if (Array.isArray(selected.message.content) && selected.message.content.some((block: unknown) => isRecord(block) && block.type === 'toolCall')) throw Error('Choose a message without unfinished tool calls.');
  return [header, ...branch.slice(0, index + 1)].map(entry => JSON.stringify(entry)).join('\n') + '\n';
}
