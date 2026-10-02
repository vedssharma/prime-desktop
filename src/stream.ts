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
