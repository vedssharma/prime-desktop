import { useEffect, useRef, useState } from 'react';

// Saved transcripts only gain whole messages, so new replies are revealed progressively
// instead of popping in. Long replies speed up to finish within MAX_REVEAL_MS.
const MIN_CHARS_PER_SECOND = 360;
const MAX_REVEAL_MS = 1400;
const FRAME_MS = 32;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Next reveal position: advance by `step`, then extend to the end of the current word so partial words and Markdown markers don't flicker. */
export function nextRevealLength(text: string, shown: number, step: number): number {
  let next = Math.min(text.length, shown + Math.max(1, Math.round(step)));
  while (next < text.length && !/\s/.test(text[next])) next++;
  return next;
}

export function useRevealedText(text: string, animate: boolean): string {
  const [shown, setShown] = useState(() => animate && !reducedMotion() ? 0 : text.length);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (shownRef.current >= text.length) return;
    if (reducedMotion()) { setShown(text.length); return; }
    const speed = Math.max(MIN_CHARS_PER_SECOND, ((text.length - shownRef.current) / MAX_REVEAL_MS) * 1000);
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) {
        const next = nextRevealLength(text, shownRef.current, ((now - last) / 1000) * speed);
        last = now;
        shownRef.current = next;
        setShown(next);
        if (next >= text.length) return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  // If content was replaced by something shorter, never show a stale prefix length.
  return shown >= text.length ? text : text.slice(0, shown);
}
