import type { Message, Session } from '../shared/types';

export type ExportFormat = 'markdown' | 'json';

const roleLabel: Record<Message['role'], string> = { user: 'You', assistant: 'Prime', tool: 'Tool', system: 'System' };

// A fence longer than any backtick run inside the text, so tool output cannot close it early.
function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
  return '`'.repeat(longest + 1);
}

export function conversationToMarkdown(session: Pick<Session, 'title' | 'cwd' | 'model'>, messages: Message[]): string {
  const lines = [`# ${(session.title || 'Untitled session').replace(/\s+/g, ' ').trim()}`, ''];
  lines.push(`- Workspace: \`${session.cwd}\``, `- Model: ${session.model || 'CLI default'}`, `- Messages: ${messages.length}`, '');
  for (const message of messages) {
    const label = message.role === 'tool' ? `Tool: ${message.toolName || 'call'}` : roleLabel[message.role];
    lines.push(`## ${label}${message.timestamp ? ` · ${message.timestamp}` : ''}`, '');
    if (message.role === 'tool') { const marks = fence(message.content); lines.push(marks, message.content || 'No output', marks); }
    else lines.push(message.content);
    lines.push('');
  }
  return lines.join('\n');
}

export function conversationToJson(session: Session, messages: Message[]): string {
  const { id, title, cwd, model, createdAt, updatedAt } = session;
  return JSON.stringify({ session: { id, title, cwd, model, createdAt, updatedAt }, messages }, null, 2);
}

export function exportFileName(title: string, format: ExportFormat): string {
  const base = title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'conversation';
  return `${base}.${format === 'markdown' ? 'md' : 'json'}`;
}
