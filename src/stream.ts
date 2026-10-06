import type { Message } from '../shared/types';

/**
 * Replace the in-progress reply (and its tool-call rows) with the latest streamed version.
 * The reply is always the newest part of the transcript, so it goes at the end.
 */
export function mergeStream(previous: Message[], streamId: string, streamed: Message[]): Message[] {
  const callPrefix = `${streamId}-call-`;
  const kept = previous.filter(message => message.id !== streamId && !message.id.startsWith(callPrefix));
  return [...kept, ...streamed];
}

/**
 * Cheap change check for polled transcripts: message IDs plus the tail of the newest message,
 * which is the one that grows while an agent works.
 */
export function transcriptSignature(sessionId: string, messages: Message[]): string {
  const last = messages.at(-1);
  return [sessionId, messages.length, messages.map(message => message.id).join('\u0000'),
    last ? `${last.content.length}:${last.content.slice(-200)}:${last.diff?.length ?? 0}:${last.images?.length ?? 0}` : ''].join('\u0001');
}

export const RUNNING_POLL_MS = 600;
export const MAX_RUNNING_POLL_MS = 3000;
export const PUSHED_POLL_MS = 3000;
export const IDLE_POLL_MS = 10_000;

/**
 * Next transcript read. Desktop-owned sessions get streamed updates, so their poll is only a
 * safety net. Running shared CLI sessions start at 600 ms and back off while nothing changes.
 */
export function pollDelay(running: boolean, pushed: boolean, unchangedReads: number): number {
  if (!running) return IDLE_POLL_MS;
  if (pushed) return PUSHED_POLL_MS;
  return Math.min(MAX_RUNNING_POLL_MS, RUNNING_POLL_MS * 2 ** Math.max(0, unchangedReads - 1));
}
