import type { Message } from '../shared/types';

export type ConversationItem =
  | { kind: 'message'; message: Message }
  | { kind: 'trace'; id: string; steps: Message[] };

// Within each turn (the messages between user prompts), everything from the first
// tool call through the last one is folded into a single trace, including any
// interim assistant narration. The assistant's opening line and final answer stay visible.
export function groupConversation(messages: Message[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  let turn: Message[] = [];
  const flush = () => {
    const first = turn.findIndex(message => message.role === 'tool');
    if (first === -1) { for (const message of turn) items.push({ kind: 'message', message }); }
    else {
      let last = turn.length - 1;
      while (turn[last].role !== 'tool') last--;
      for (const message of turn.slice(0, first)) items.push({ kind: 'message', message });
      items.push({ kind: 'trace', id: `trace-${turn[first].id}`, steps: turn.slice(first, last + 1) });
      for (const message of turn.slice(last + 1)) items.push({ kind: 'message', message });
    }
    turn = [];
  };
  for (const message of messages) {
    if (message.role === 'user') { flush(); items.push({ kind: 'message', message }); }
    else turn.push(message);
  }
  flush();
  return items;
}
