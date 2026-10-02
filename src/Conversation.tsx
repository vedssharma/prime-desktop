import type { RefObject } from 'react';
import { CircleHelp, LoaderCircle, MessageSquare } from 'lucide-react';
import type { Message, Session } from '../shared/types';
import type { groupConversation } from './trace';
import DockMark from './DockMark';
import { MessageView, TraceView } from './MessageViews';

type Props = {
  conversationRef: RefObject<HTMLDivElement | null>;
  knownIds: RefObject<Set<string> | null>;
  active: Session | undefined;
  running: boolean;
  loadingMessages: boolean;
  messages: Message[];
  conversationItems: ReturnType<typeof groupConversation>;
  visibleMessages: number;
  setVisibleMessages: (update: (count: number) => number) => void;
  setFollow: (value: boolean) => void;
};

export default function Conversation({ conversationRef, knownIds, active, running, loadingMessages, messages, conversationItems, visibleMessages, setVisibleMessages, setFollow }: Props) {
  return <div className="conversation" ref={conversationRef}>{loadingMessages ? <div className="messages-loading"><LoaderCircle size={18} className="spin" />Loading conversation...</div> : messages.length ? <>{messages.length > visibleMessages && <button className="secondary-button" onClick={() => { setFollow(false); setVisibleMessages(count => count + 100); }}>Load earlier messages ({messages.length - visibleMessages})</button>}{conversationItems.map((item, index) => item.kind === 'trace' ? <TraceView key={item.id} steps={item.steps} active={running && index === conversationItems.length - 1} /> : <MessageView key={item.message.id} message={item.message} animate={!!knownIds.current && !knownIds.current.has(item.message.id)} />)}</> : <div className="conversation-empty"><MessageSquare size={26} /><h2>The next step is yours.</h2><p>Send a message to continue this session.</p></div>}{running && <div className="working-indicator" role="status"><DockMark /><span>Prime is working<span className="thinking-dots"><i /><i /><i /></span></span></div>}{active?.status === 'error' && <div className="system-message"><CircleHelp size={15} />This session stopped with an error. Check its history before retrying. Closed or uncertain desktop sessions cannot accept new prompts.</div>}</div>;
}
