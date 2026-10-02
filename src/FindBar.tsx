import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { findRanges } from './find';

const MATCH = 'find-match', CURRENT = 'find-current';
type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };
/** CSS Custom Highlight API: marks matches without touching the rendered Markdown DOM. */
const highlights = (): Highlights | undefined => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights;
const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

type Props = {
  containerRef: RefObject<HTMLElement | null>;
  /** Changes whenever the rendered conversation may have changed, so matches are recomputed. */
  version: unknown;
  hiddenCount: number;
  onShowAll: () => void;
  onClose: () => void;
  focusRequest: number;
};

export default function FindBar({ containerRef, version, hiddenCount, onShowAll, onClose, focusRequest }: Props) {
  const [query, setQuery] = useState('');
  const [ranges, setRanges] = useState<Range[]>([]);
  const [current, setCurrent] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRequest]);
  useEffect(() => {
    // Streaming replies re-render often; recompute shortly after the content settles.
    const timer = setTimeout(() => {
      const root = containerRef.current;
      const next = root ? findRanges(root, query) : [];
      setRanges(next);
      setCurrent(index => next.length ? Math.min(index, next.length - 1) : 0);
    }, 80);
    return () => clearTimeout(timer);
  }, [query, version, hiddenCount, containerRef]);
  useEffect(() => {
    const registry = highlights();
    if (!registry || !Highlight) return;
    registry.set(MATCH, new Highlight(...ranges));
    const active = ranges[current];
    if (active) registry.set(CURRENT, new Highlight(active)); else registry.delete(CURRENT);
    return () => { registry.delete(MATCH); registry.delete(CURRENT); };
  }, [ranges, current]);
  useEffect(() => {
    const active = ranges[current];
    if (!active) return;
    // Collapsed tool output still counts; open it so the match is visible.
    for (let details = active.startContainer.parentElement?.closest('details'); details; details = details.parentElement?.closest('details')) {
      if (!details.open) details.open = true;
    }
    active.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }, [ranges, current]);
  const step = (direction: 1 | -1) => { if (ranges.length) setCurrent(index => (index + direction + ranges.length) % ranges.length); };
  return <div className="find-bar" role="search" aria-label="Find in conversation">
    <input ref={input} aria-label="Find in conversation" placeholder="Find in conversation" value={query} onChange={event => { setQuery(event.target.value); setCurrent(0); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }} />
    <span className="find-count" role="status">{query ? ranges.length ? `${current + 1} of ${ranges.length}` : 'No matches' : ''}</span>
    <button type="button" className="icon-button" aria-label="Previous match" disabled={!ranges.length} onClick={() => step(-1)}><ChevronUp size={15} /></button>
    <button type="button" className="icon-button" aria-label="Next match" disabled={!ranges.length} onClick={() => step(1)}><ChevronDown size={15} /></button>
    <button type="button" className="icon-button" aria-label="Close find" onClick={onClose}><X size={15} /></button>
    {query && hiddenCount > 0 && <button type="button" className="find-show-all" onClick={onShowAll}>{hiddenCount} earlier message{hiddenCount === 1 ? '' : 's'} not searched · Load all</button>}
  </div>;
}
