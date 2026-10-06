import type { Message } from '../shared/types';

/** One rendered row of an edit diff. `number` is the file line number when the agent reported one. */
export interface DiffRow { kind: 'add' | 'del' | 'context' | 'gap'; number?: string; text: string }
export interface ToolDiff { path?: string; rows: DiffRow[]; applied: boolean }

/** Larger diffs fall back to the raw view; rendering thousands of rows per tool call is not useful. */
export const MAX_DIFF_ROWS = 2000;

/**
 * Parses Prime Agent's edit result diff (`details.diff`): each line is a +, - or space marker, a
 * right-aligned line number, a space, then the text. A context line of `...` marks skipped lines.
 */
export function parseAgentDiff(diff: string): DiffRow[] | undefined {
  const rows: DiffRow[] = [];
  for (const line of diff.split('\n')) {
    const match = /^([+\- ])( *\d*) (.*)$/.exec(line);
    if (!match) {
      if (line === '') continue;
      return undefined;
    }
    const [, marker, number, text] = match;
    const kind = marker === '+' ? 'add' : marker === '-' ? 'del' : 'context';
    if (kind === 'context' && !number.trim() && text === '...') rows.push({ kind: 'gap', text: '…' });
    else rows.push({ kind, number: number.trim() || undefined, text });
  }
  return rows.length && rows.length <= MAX_DIFF_ROWS ? rows : undefined;
}

const lines = (text: string) => text.replace(/\n$/, '').split('\n');

/** Proposed replacements from an `edit` tool call's arguments (current `edits[]` or legacy oldText/newText). */
export function editCallDiff(content: string): ToolDiff | undefined {
  let args: unknown;
  try { args = JSON.parse(content); } catch { return undefined; }
  if (!args || typeof args !== 'object') return undefined;
  const record = args as { path?: unknown; edits?: unknown; oldText?: unknown; newText?: unknown };
  const edits: { oldText: string; newText: string }[] = [];
  if (Array.isArray(record.edits)) {
    for (const edit of record.edits) {
      if (!edit || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') return undefined;
      edits.push({ oldText: edit.oldText, newText: edit.newText });
    }
  }
  if (typeof record.oldText === 'string' && typeof record.newText === 'string') edits.push({ oldText: record.oldText, newText: record.newText });
  if (!edits.length) return undefined;
  const rows: DiffRow[] = [];
  edits.forEach((edit, index) => {
    if (index) rows.push({ kind: 'gap', text: '…' });
    rows.push(...lines(edit.oldText).map(text => ({ kind: 'del' as const, text })));
    rows.push(...lines(edit.newText).map(text => ({ kind: 'add' as const, text })));
  });
  if (rows.length > MAX_DIFF_ROWS) return undefined;
  return { path: typeof record.path === 'string' && record.path ? record.path : undefined, rows, applied: false };
}

/** A diff view for edit tool calls and their results; undefined for every other tool step. */
export function toolDiff(step: Pick<Message, 'role' | 'toolName' | 'content' | 'diff'>): ToolDiff | undefined {
  if (step.role !== 'tool' || step.toolName !== 'edit') return undefined;
  if (step.diff) {
    const rows = parseAgentDiff(step.diff);
    return rows && { rows, applied: true };
  }
  return editCallDiff(step.content);
}

/** Lines added and removed, for the summary row. */
export function diffCounts(rows: DiffRow[]) {
  return { added: rows.filter(row => row.kind === 'add').length, removed: rows.filter(row => row.kind === 'del').length };
}
