import { createContext, memo, useContext, useState } from 'react';
import { Check, ChevronRight, CircleHelp, Copy, FilePen, GitBranch, LoaderCircle, Sparkles, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../shared/types';
import DockMark from './DockMark';
import { markdownComponents } from './Markdown';
import { MessageImages } from './ImageAttachments';
import { sameImages } from './attachments';
import { useRevealedText } from './reveal';
import { errorText, messageTime, toolPreview } from './format';
import { diffCounts, toolDiff, type ToolDiff } from './toolDiff';

/** Opens the workspace panel on a file's Git changes; null when no session is open. */
export const ShowChangeContext = createContext<((path: string) => void) | null>(null);

function EditDiff({ diff }: { diff: ToolDiff }) {
  return <pre className="diff-view tool-diff" aria-label={diff.applied ? 'Applied changes' : 'Proposed changes'}>{diff.rows.map((row, index) =>
    <span key={index} className={`diff-line ${row.kind}`}><span className="diff-number" aria-hidden="true">{row.number ?? ''}</span><span className="diff-marker" aria-hidden="true">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>{row.text || ' '}{'\n'}</span>)}</pre>;
}

function ToolCall({ step }: { step: Message }) {
  const diff = toolDiff(step);
  const [raw, setRaw] = useState(false);
  const showChange = useContext(ShowChangeContext);
  const output = <pre>{step.content || (step.images?.length ? '' : 'No output')}</pre>;
  if (!diff) return <details className="tool-message"><summary><Terminal size={14} /><span>{step.toolName || 'Tool call'}</span><span className="tool-preview">{toolPreview(step.content)}</span><ChevronRight size={14} /></summary>{output}<MessageImages images={step.images} /></details>;
  const { added, removed } = diffCounts(diff.rows);
  return <details className="tool-message edit-message"><summary><FilePen size={14} /><span>{step.toolName}</span><span className="tool-preview">{diff.path ?? (diff.applied ? 'Applied changes' : toolPreview(step.content))}</span><span className="diff-counts"><span className="diff-added">+{added}</span> <span className="diff-removed">-{removed}</span></span><ChevronRight size={14} /></summary>
    <div className="tool-diff-actions">
      <button type="button" className="text-button" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? 'Show diff' : 'Show raw'}</button>
      {diff.path && showChange && <button type="button" className="text-button" onClick={() => showChange(diff.path!)}><GitBranch size={12} />Show in Changes</button>}
    </div>
    {raw ? output : <EditDiff diff={diff} />}
  </details>;
}
export const MessageView = memo(function MessageView({ message, animate = false }: { message: Message; animate?: boolean }) {
  const [copied, setCopied] = useState(false);
  const revealed = useRevealedText(message.content, animate && message.role === 'assistant');
  const [copyError, setCopyError] = useState('');
  if (message.role === 'tool') return <ToolCall step={message} />;
  if (message.role === 'system') return <div className="system-message"><CircleHelp size={14} /><span>{message.content}</span><MessageImages images={message.images} /></div>;
  return <article className={`message ${message.role}`}><div className={`message-avatar ${message.role === 'assistant' ? 'agent-avatar' : ''}`}>{message.role === 'assistant' ? <DockMark /> : 'Y'}</div><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Prime' : 'You'}</strong>{message.role === 'assistant' && <span className="agent-label">AGENT</span>}{message.timestamp && <time dateTime={message.timestamp} title={new Date(message.timestamp).toLocaleString()}>{messageTime(message.timestamp)}</time>}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{revealed}</ReactMarkdown></div><MessageImages images={message.images} />{message.role === 'assistant' && <button className="copy-message icon-button" aria-label={copied ? 'Response copied' : 'Copy response'} title="Copy response" onClick={() => { setCopyError(''); void window.prime.copyText(message.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(error => setCopyError(`Copy failed: ${errorText(error)}`)); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}{copyError && <p role="alert">{copyError}</p>}</div></article>;
}, (a, b) => a.message.id === b.message.id && a.message.content === b.message.content && a.message.role === b.message.role && a.message.timestamp === b.message.timestamp && a.message.toolName === b.message.toolName && a.message.diff === b.message.diff && sameImages(a.message.images, b.message.images));
export const TraceView = memo(function TraceView({ steps, active }: { steps: Message[]; active: boolean }) {
  const calls = steps.filter(step => step.role === 'tool').length;
  const label = `${calls} tool ${calls === 1 ? 'call' : 'calls'}`;
  return <details className="trace"><summary>{active ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}<span className="trace-title">{active ? 'Working' : 'Thought process'}</span><span className="trace-count">{label}</span><ChevronRight size={14} /></summary><div className="trace-steps">{steps.map(step => step.role === 'tool' ? <ToolCall key={step.id} step={step} /> : step.role === 'system' ? <div key={step.id} className="system-message"><CircleHelp size={14} /><span>{step.content}</span></div> : <div key={step.id} className="trace-note markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{step.content}</ReactMarkdown><MessageImages images={step.images} /></div>)}</div></details>;
}, (a, b) => a.active === b.active && a.steps.length === b.steps.length && a.steps.every((step, i) => step.id === b.steps[i].id && step.content === b.steps[i].content && step.toolName === b.steps[i].toolName && step.diff === b.steps[i].diff));
