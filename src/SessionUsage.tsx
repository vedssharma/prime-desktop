import { useCallback, useEffect, useState } from 'react';
import type { SessionUsage as Usage } from '../shared/types';
import { errorText } from './format';

const count = (value: number) => value.toLocaleString();
const money = (value: number) => value === 0 ? '$0.00' : value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;

/**
 * Usage and manual compaction for a desktop-owned session. Compaction rewrites the
 * agent's working context inside the same session; it is not a fork.
 */
export default function SessionUsage({ sessionId, idle, onCompacted, onError }: { sessionId: string; idle: boolean; onCompacted: () => void; onError: (message: string) => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    try { const next = await window.prime.getSessionUsage(sessionId); setUsage(next); setProblem(''); }
    catch (error) { setUsage(null); setProblem(errorText(error)); }
  }, [sessionId]);
  useEffect(() => { setNote(''); void load(); }, [load, idle]);
  async function compact() {
    if (busy || !idle) return;
    setBusy(true); setNote('');
    try {
      const result = await window.prime.compactSession(sessionId);
      setNote(result.tokensBefore === null ? 'Context compacted.' : `Context compacted from about ${count(result.tokensBefore)} tokens.`);
      onCompacted();
    } catch (error) { onError(`Compact context: ${errorText(error)}`); }
    finally { setBusy(false); void load(); }
  }
  const context = usage?.context;
  return <div className="session-usage">
    {problem ? <p>Usage is unavailable: {problem}</p> : !usage ? <p>Loading usage...</p> : <>
      <p>{count(usage.tokens.total)} tokens ({count(usage.tokens.input)} in, {count(usage.tokens.output)} out, {count(usage.tokens.cacheRead)} cached) · {money(usage.cost)} estimated · {usage.toolCalls} tool call{usage.toolCalls === 1 ? '' : 's'}</p>
      {context && <p>{context.tokens === null || context.percent === null ? 'Context size will be estimated after the next response.' : `Context: ${count(context.tokens)}${context.contextWindow ? ` of ${count(context.contextWindow)}` : ''} tokens (${Math.round(context.percent)}%).`}</p>}
    </>}
    <button type="button" onClick={() => void compact()} disabled={busy || !idle} title={idle ? 'Summarize older conversation to free context space' : 'Available when the session is idle'}>{busy ? 'Compacting...' : 'Compact context'}</button>
    {note && <span role="status"> {note}</span>}
  </div>;
}
