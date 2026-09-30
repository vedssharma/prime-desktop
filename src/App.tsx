import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Copy, Folder, Download, FolderOpen, GitBranch, PanelRight, LoaderCircle, Menu, MessageSquare, MoreHorizontal, PanelLeftClose, Plus, RefreshCw, Search, Sparkles, Square, Settings, Terminal, Trash2, X, Pencil, Pin, PinOff, Tag, Zap } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConnectionStatus, Message, ModelOption, Session, ImageAttachment } from '../shared/types';
import './styles.css';
import { loadPreferences, savePreferences } from './preferences';
import AppearanceSettings from './AppearanceSettings';
import ThirdPartyNotices from './ThirdPartyNotices';
import ConnectionSettings from './ConnectionSettings';
import DisplaySettings from './DisplaySettings';
import ProviderSettings from './ProviderSettings';
import { groupConversation } from './trace';
import { useRevealedText } from './reveal';
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from './appearance';
import { conversationToJson, conversationToMarkdown, exportFileName, type ExportFormat } from './export';
import { finishedSessions, loadNotify, notificationFor } from './notify';
import WorkspacePanel from './WorkspacePanel';
import SessionUsage from './SessionUsage';
import CommandPalette from './CommandPalette';
import type { Command } from './commands';
import { allTags, groupSessions, loadSessionMeta, normalizeTags, saveSessionMeta, setTags, togglePin, MAX_TAGS, MAX_TAG_LENGTH, type SessionMeta } from './sessionMeta';
import { languageFor, tokenize } from './highlight';
import { ImagePicker, DraftImages, MessageImages } from './ImageAttachments';
import { readImageFiles, sameImages, type DraftImage } from './attachments';
import { validateImages, promptCommand } from '../electron/attachments';
import { errorText, folderName, toolPreview, messageTime, relativeTime } from './format';

const isElectron = navigator.userAgent.includes('Electron');
const newSessionShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ N' : 'Ctrl N';
const paletteShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K';
const starters = [
  { icon: Code2, title: 'Build something new', description: 'Turn an idea into working code', prompt: 'Help me build a new project. First, ask me about what I want to create.' },
  { icon: Search, title: 'Explore a codebase', description: 'Find your way around a project', prompt: 'Explore this codebase and explain its structure, key components, and how to get started.' },
  { icon: GitBranch, title: 'Make it better', description: 'Find bugs and thoughtful improvements', prompt: 'Review this project for bugs and opportunities to improve it. Explain your findings before making changes.' },
];
function DockMark({ className = '' }: { className?: string }) { return <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="7" y="4" width="18" height="15" rx="3" stroke="currentColor" strokeWidth="2.5" /><path d="m11 9 3 3-3 3m7 0h3M4 20v5a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3v-5M4 21h7l2 3h6l2-3h7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  // Copy the rendered text so it matches exactly what is displayed, without Markdown fences.
  const copy = () => { setCopyError(''); void window.prime.copyText((pre.current?.textContent ?? '').replace(/\n$/, '')).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(error => setCopyError(`Copy failed: ${errorText(error)}`)); };
  return <div className="code-block"><pre ref={pre}>{children}</pre><button type="button" className="copy-code icon-button" aria-label={copied ? 'Code copied' : 'Copy code'} title="Copy code" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>{copyError && <p role="alert">{copyError}</p>}</div>;
}
// Untrusted Markdown: links open externally and images are never loaded inline.
const markdownComponents: Components = {
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  img: ({ alt, src }) => <a href={src} target="_blank" rel="noreferrer">[Image: {alt || 'View image'}]</a>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) => {
    const language = languageFor(className);
    if (!language || typeof children !== 'string') return <code className={className}>{children}</code>;
    return <code className={className}>{tokenize(children, language).map((token, index) => token.kind === 'plain' ? token.text : <span key={index} className={`tok-${token.kind}`}>{token.text}</span>)}</code>;
  },
};
function ToolCall({ step }: { step: Message }) { return <details className="tool-message"><summary><Terminal size={14} /><span>{step.toolName || 'Tool call'}</span><span className="tool-preview">{toolPreview(step.content)}</span><ChevronRight size={14} /></summary><pre>{step.content || (step.images?.length ? '' : 'No output')}</pre><MessageImages images={step.images} /></details>; }
const MessageView = memo(function MessageView({ message, animate = false }: { message: Message; animate?: boolean }) {
  const [copied, setCopied] = useState(false);
  const revealed = useRevealedText(message.content, animate && message.role === 'assistant');
  const [copyError, setCopyError] = useState('');
  if (message.role === 'tool') return <ToolCall step={message} />;
  if (message.role === 'system') return <div className="system-message"><CircleHelp size={14} /><span>{message.content}</span><MessageImages images={message.images} /></div>;
  return <article className={`message ${message.role}`}><div className={`message-avatar ${message.role === 'assistant' ? 'agent-avatar' : ''}`}>{message.role === 'assistant' ? <DockMark /> : 'Y'}</div><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Prime' : 'You'}</strong>{message.role === 'assistant' && <span className="agent-label">AGENT</span>}{message.timestamp && <time dateTime={message.timestamp} title={new Date(message.timestamp).toLocaleString()}>{messageTime(message.timestamp)}</time>}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{revealed}</ReactMarkdown></div><MessageImages images={message.images} />{message.role === 'assistant' && <button className="copy-message icon-button" aria-label={copied ? 'Response copied' : 'Copy response'} title="Copy response" onClick={() => { setCopyError(''); void window.prime.copyText(message.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(error => setCopyError(`Copy failed: ${errorText(error)}`)); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}{copyError && <p role="alert">{copyError}</p>}</div></article>;
}, (a, b) => a.message.id === b.message.id && a.message.content === b.message.content && a.message.role === b.message.role && a.message.timestamp === b.message.timestamp && a.message.toolName === b.message.toolName && sameImages(a.message.images, b.message.images));
const TraceView = memo(function TraceView({ steps, active }: { steps: Message[]; active: boolean }) {
  const calls = steps.filter(step => step.role === 'tool').length;
  const label = `${calls} tool ${calls === 1 ? 'call' : 'calls'}`;
  return <details className="trace"><summary>{active ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}<span className="trace-title">{active ? 'Working' : 'Thought process'}</span><span className="trace-count">{label}</span><ChevronRight size={14} /></summary><div className="trace-steps">{steps.map(step => step.role === 'tool' ? <ToolCall key={step.id} step={step} /> : step.role === 'system' ? <div key={step.id} className="system-message"><CircleHelp size={14} /><span>{step.content}</span></div> : <div key={step.id} className="trace-note markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{step.content}</ReactMarkdown><MessageImages images={step.images} /></div>)}</div></details>;
}, (a, b) => a.active === b.active && a.steps.length === b.steps.length && a.steps.every((step, i) => step.id === b.steps[i].id && step.content === b.steps[i].content && step.toolName === b.steps[i].toolName));

export default function App() {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [allowFileChanges, setAllowFileChanges] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [visibleMessages, setVisibleMessages] = useState(100);
  const [search, setSearch] = useState('');
  const [preferences] = useState(loadPreferences);
  const [drafts, setDrafts] = useState<Record<string, { text: string; images: DraftImage[]; revision: number; attachmentError?: string }>>({});
  const draftKey = activeId ?? 'new-session';
  const draftEntry = drafts[draftKey];
  const draft = draftEntry?.text ?? '';
  const draftImages = draftEntry?.images ?? [];
  const [readingImages, setReadingImages] = useState<Record<string, boolean>>({});
  const readingKeys = useRef(new Set<string>());
  const reading = !!readingImages[draftKey];
  const setDraft = (text: string) => setDrafts(previous => ({ ...previous, [draftKey]: { ...previous[draftKey], text, images: previous[draftKey]?.images ?? [], revision: (previous[draftKey]?.revision ?? 0) + 1 } }));
  const clearSubmittedDraft = (key: string, revision: number | undefined) => setDrafts(previous => {
    if (previous[key]?.revision !== revision) return previous;
    return { ...previous, [key]: { text: '', images: [], revision: (revision ?? 0) + 1 } };
  });
  const [cwd, setCwd] = useState(preferences.cwd);
  const [model, setModel] = useState(preferences.model);
  useEffect(() => { setAllowFileChanges(false); }, [cwd]);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const notice = notices[draftKey];
  const [preferencesError, setPreferencesError] = useState(false);
  useEffect(() => { setPreferencesError(!savePreferences({ cwd, model })); }, [cwd, model]);
  const [pendingBySession, setPendingBySession] = useState<Record<string, boolean>>({});
  const pendingKeys = useRef(new Set<string>());
  const pending = !!pendingBySession[draftKey];
  const setPendingFor = (key: string, value: boolean) => {
    if (value) pendingKeys.current.add(key); else pendingKeys.current.delete(key);
    setPendingBySession(previous => ({ ...previous, [key]: value }));
  };
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia('(max-width: 900px)');
    const changed = () => { setNarrow(media.matches); if (!media.matches) setSidebarOpen(false); };
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed);
  }, []);
  const drawerOpen = narrow && sidebarOpen;
  useEffect(() => {
    if (!drawerOpen) return;
    sidebarRef.current?.querySelector<HTMLButtonElement>('.mobile-close')?.focus();
    return () => { sidebarToggle.current?.focus(); };
  }, [drawerOpen]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'rename' | 'delete' | 'about' | 'settings' | 'close-owned' | 'tags' | 'palette' | null>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const [appearance, setAppearance] = useState(loadAppearance);
  const [appearanceStorageError, setAppearanceStorageError] = useState(false);
  const dialogOpener = useRef<HTMLElement | null>(null);
  function changeAppearance(next: Appearance) {
    setAppearance(next);
    setAppearanceStorageError(!saveAppearance(next));
  }
  useEffect(() => {
    applyAppearance(appearance);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyAppearance(appearance);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [appearance]);
  useEffect(() => {
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogOpener.current = opener;
    // Keep the form's autofocus target when present; otherwise focus Close.
    const modal = document.querySelector<HTMLElement>('.modal');
    if (!modal?.contains(document.activeElement)) modal?.querySelector<HTMLElement>('.modal-close')?.focus();
    return () => { if (dialogOpener.current?.isConnected) dialogOpener.current.focus(); };
  }, [dialog]);
  const [renameTitle, setRenameTitle] = useState('');
  const [dialogPending, setDialogPending] = useState(false);
  const dialogPendingRef = useRef(false);
  dialogPendingRef.current = dialogPending;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  // Mirrors followBottom for rendering: offer a way back when the user has scrolled away from new output.
  const [showJump, setShowJump] = useState(false);
  const setFollow = (value: boolean) => { followBottom.current = value; setShowJump(!value); };
  // Content growing below the viewport is not the user scrolling away; only an upward scroll stops following.
  const lastScrollTop = useRef(0);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const active = sessions.find(session => session.id === activeId);
  const running = active?.status === 'running';
  const readOnly = active ? active.ownership === 'desktop' ? !active.writable : connection?.readOnly === true : connection?.readOnly === true && !connection?.canCreateOwned;
  const readyToSend = !!connection?.connected || !!connection?.canCreateOwned || active?.writable === true;
  const requiresConsent = !activeId && connection?.canCreateOwned === true;
  const canAttach = active ? active.ownership === 'desktop' && active.writable === true && active.supportsImages !== false : connection?.canCreateOwned === true;
  const attachmentReason = active?.supportsImages === false ? 'Choose an image-capable model to attach images.' : 'Images are available in writable desktop-owned sessions.';
  const runningRef = useRef(running); runningRef.current = running;
  const conversationItems = groupConversation(messages.slice(-visibleMessages));
  const currentCwd = active?.cwd || cwd;
  const refresh = useCallback(async () => { const list = await window.prime.listSessions(); setSessions(list); }, []);
  const messageRead = useRef(0);
  // Message IDs present when the session was opened; only replies that arrive later are revealed progressively.
  const knownIds = useRef<Set<string> | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const pollMessagesNow = useRef<() => void>(() => {});
  const readMessages = useCallback(async (id: string) => {
    const request = ++messageRead.current;
    try {
      const next = await window.prime.getMessages(id);
      if (request === messageRead.current && activeIdRef.current === id) { knownIds.current ??= new Set(next.map(message => message.id)); setMessages(next); }
    } catch (error) {
      if (request === messageRead.current && activeIdRef.current === id) throw error;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const status = await window.prime.status();
        if (cancelled) return;
        setConnection(status); setCwd(previous => previous || status.home);
        if (status.connected || status.canCreateOwned) {
          // Model discovery can be slow. Do not block the session list on it.
          // Model discovery is handled independently on each connection transition.
          const list = await window.prime.listSessions();
          if (!cancelled) setSessions(list);
        }
      } catch (err) { if (!cancelled) setError(errorText(err)); }
      finally { if (!cancelled) setLoading(false); }
    }
    void initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!connection?.connected && !connection?.canCreateOwned) return;
    let cancelled = false;
    void window.prime.listModels().then(choices => { if (!cancelled) setModels(choices); }).catch(error => { if (!cancelled) setError(`Model discovery: ${errorText(error)}`); });
    return () => { cancelled = true; };
  }, [connection?.connected, connection?.canCreateOwned]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const status = await window.prime.status();
        if (!stopped) setConnection(status);
        if (status.connected || status.canCreateOwned) {
          const list = await window.prime.listSessions();
          if (!stopped) setSessions(list);
        }
      } catch (err) { if (!stopped) setConnection(previous => ({ connected: false, home: previous?.home || '', error: errorText(err) })); }
      if (!stopped) timer = setTimeout(poll, running ? 2000 : 5000);
    }
    timer = setTimeout(poll, 2500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [running]);

  useEffect(() => {
    // Errors belong to the view that caused them; do not carry them into another session.
    setMessages([]); setVisibleMessages(100); setError(''); setFollow(true); knownIds.current = null;
    // Swapping content clamps scrollTop; that is not the user scrolling up, so reset the baseline.
    lastScrollTop.current = 0;
    if (!activeId) { setLoadingMessages(false); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setLoadingMessages(true);
    async function poll() {
      try { await readMessages(activeId!); }
      catch (err) { if (!cancelled) setError(errorText(err)); }
      finally { if (!cancelled) { setLoadingMessages(false); clearTimeout(timer); timer = setTimeout(poll, runningRef.current ? 600 : 10000); } }
    }
    // A run that starts while the idle timer is pending must not wait out the idle delay.
    pollMessagesNow.current = () => { if (!cancelled) { clearTimeout(timer); void poll(); } };
    void poll();
    return () => { cancelled = true; ++messageRead.current; clearTimeout(timer); pollMessagesNow.current = () => {}; };
  }, [activeId, readMessages]);

  useEffect(() => { if (followBottom.current && scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight; }, [messages, running, loadingMessages]);
  useEffect(() => { if (running) pollMessagesNow.current(); }, [running]);
  useEffect(() => {
    // Keep following the bottom while a revealed reply grows, not just when messages change.
    const node = conversationRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (followBottom.current && scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight; });
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeId]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 190)}px`; } }, [draft]);
  const newSession = useCallback(() => { setActiveId(null); setAllowFileChanges(false); setSidebarOpen(false); setMenuOpen(false); setTimeout(() => { if (!dialogRef.current && activeIdRef.current === null) textarea.current?.focus(); }, 50); }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!dialogRef.current) newSession(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (dialogRef.current === 'palette') setDialog(null); else if (!dialogRef.current) { setSidebarOpen(false); setMenuOpen(false); setDialog('palette'); } } if (event.key === 'Escape') { if (dialogPendingRef.current) return; setDialog(null); setMenuOpen(false); setSidebarOpen(false); } };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [newSession]);

  const lastStatuses = useRef(new Map<string, Session['status']>());
  useEffect(() => {
    if (loadNotify()) for (const session of finishedSessions(lastStatuses.current, sessions)) {
      const { title, body } = notificationFor(session);
      void Promise.resolve(window.prime.notify?.(title, body, session.id)).catch(() => {});
    }
    lastStatuses.current = new Map(sessions.map(session => [session.id, session.status]));
  }, [sessions]);
  useEffect(() => window.prime.onNotificationClick?.(id => { if (!dialogRef.current) { setActiveId(id); setSidebarOpen(false); setMenuOpen(false); } }), []);

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [meta, setMeta] = useState(loadSessionMeta);
  const [tagFilter, setTagFilter] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [metaStorageError, setMetaStorageError] = useState(false);
  const updateMeta = (next: SessionMeta) => { setMeta(next); setMetaStorageError(!saveSessionMeta(next)); };
  const grouped = useMemo(() => groupSessions(sessions, { search, tag: tagFilter, meta }), [sessions, search, tagFilter, meta]);
  const commands: Command[] = dialog === 'palette' ? [
    { id: 'new', label: 'New session', group: 'Actions', detail: newSessionShortcut, run: newSession },
    { id: 'settings', label: 'Open settings', group: 'Actions', keywords: 'appearance theme providers models connection preferences', run: () => setDialog('settings') },
    { id: 'about', label: 'About Session Dock', group: 'Actions', keywords: 'help shortcuts version', run: () => setDialog('about') },
    ...(active ? [{ id: 'workspace', label: workspaceOpen ? 'Hide workspace files and changes' : 'Show workspace files and changes', group: 'Actions' as const, keywords: 'git diff explorer folder', run: () => setWorkspaceOpen(!workspaceOpen) }] : []),
    { id: 'reconnect', label: 'Reconnect to Prime Agent', group: 'Actions', keywords: 'connect start service', run: () => void reconnect() },
    { id: 'group', label: meta.groupBy === 'date' ? 'Group sessions by workspace' : 'Group sessions by date', group: 'Actions', keywords: 'sidebar organize', run: () => updateMeta({ ...meta, groupBy: meta.groupBy === 'date' ? 'workspace' : 'date' }) },
    ...(active ? [
      { id: 'pin', label: meta.pinned.includes(active.id) ? 'Unpin this session' : 'Pin this session', group: 'Actions' as const, run: () => updateMeta(togglePin(meta, active.id)) },
      { id: 'tags', label: 'Edit tags for this session', group: 'Actions' as const, run: () => { setTagInput((meta.tags[active.id] ?? []).join(', ')); setDialog('tags'); } },
      ...(readOnly ? [] : [{ id: 'rename', label: 'Rename this session', group: 'Actions' as const, run: () => { setRenameTitle(active.title); setDialog('rename'); } }]),
      ...(running && !readOnly ? [{ id: 'stop', label: 'Stop generation', group: 'Actions' as const, run: () => void stop() }] : []),
      ...(messages.length ? [
        { id: 'export-md', label: 'Export conversation as Markdown', group: 'Actions' as const, run: () => void exportConversation('markdown') },
        { id: 'export-json', label: 'Export conversation as JSON', group: 'Actions' as const, run: () => void exportConversation('json') },
        { id: 'copy-md', label: 'Copy conversation as Markdown', group: 'Actions' as const, run: () => void exportConversation('copy') },
      ] : []),
      { id: 'reveal', label: 'Reveal workspace folder', group: 'Actions' as const, detail: folderName(active.cwd), run: () => void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err))) },
    ] : []),
    ...[...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(session => ({ id: `go-${session.id.replace(/[^\w-]/g, '_')}`, label: `Go to: ${session.title || 'Untitled session'}`, group: 'Sessions' as const, detail: folderName(session.cwd), keywords: (meta.tags[session.id] ?? []).join(' '), run: () => { setActiveId(session.id); setSidebarOpen(false); setMenuOpen(false); } })),
  ] : [];
  const knownTags = useMemo(() => allTags(meta, sessions), [meta, sessions]);
  useEffect(() => { if (tagFilter && !knownTags.some(tag => tag.toLowerCase() === tagFilter.toLowerCase())) setTagFilter(''); }, [knownTags, tagFilter]);

  async function reconnect() {
    setConnecting(true); setError('');
    try { const status = await window.prime.connect(); setConnection(status); setCwd(previous => previous || status.home); if (status.connected) {
        const [list, choices] = await Promise.allSettled([window.prime.listSessions(), window.prime.listModels()]);
        if (list.status === 'fulfilled') setSessions(list.value);
        else setError(errorText(list.reason));
        if (choices.status === 'fulfilled') setModels(choices.value);
        else setError(`Model discovery: ${errorText(choices.reason)}`);
      } else setError(status.error || 'Could not connect to Prime Agent. Check that the CLI is installed and authenticated.'); }
    catch (err) { setError(errorText(err)); } finally { setConnecting(false); }
  }
  async function chooseFolder() { try { const folder = await window.prime.chooseDirectory(); if (folder) setCwd(folder); } catch (err) { setError(errorText(err)); } }
  async function addImages(files: File[]) {
    if (!canAttach || readingKeys.current.has(draftKey)) return;
    const key = draftKey;
    readingKeys.current.add(key);
    setReadingImages(previous => ({ ...previous, [key]: true }));
    try {
      const additions = await readImageFiles(files);
      // A picker can finish after a session switch or text edit. Merge only into its original draft.
      setDrafts(previous => {
        const entry = previous[key] ?? { text: '', images: [], revision: 0 };
        try {
          const images = [...entry.images, ...additions];
          validateImages(images);
          return { ...previous, [key]: { ...entry, images, attachmentError: '', revision: entry.revision + 1 } };
        } catch (error) { return { ...previous, [key]: { ...entry, attachmentError: errorText(error) } }; }
      });
    } catch (error) {
      setDrafts(previous => ({ ...previous, [key]: { ...(previous[key] ?? {text:'', images:[], revision:0}), attachmentError: errorText(error) } }));
    } finally {
      readingKeys.current.delete(key);
      setReadingImages(previous => ({ ...previous, [key]: false }));
    }
  }
  function removeImage(id: string) {
    setDrafts(previous => {
      const entry = previous[draftKey];
      if (!entry) return previous;
      return { ...previous, [draftKey]: { ...entry, images: entry.images.filter(image => image.id !== id), attachmentError: '', revision: entry.revision + 1 } };
    });
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (readOnly || dialogRef.current || (!text && !draftImages.length) || readingKeys.current.has(draftKey) || pendingKeys.current.has(draftKey) || !readyToSend || (!activeId && !cwd) || (requiresConsent && !allowFileChanges)) return;
    let images: ImageAttachment[] | undefined;
    try { images = promptCommand(text, draftImages).images; }
    catch (error) { setError(errorText(error)); return; }
    const target = activeId;
    const submittedKey = draftKey;
    const submittedRevision = draftEntry?.revision;
    const queued = !!target && running;
    setPendingFor(submittedKey, true); setError('');
    setNotices(previous => ({ ...previous, [submittedKey]: '' }));
    let accepted = false;
    try {
      if (target) {
        await window.prime.sendMessage(target, text, ...(images?.length ? [images] : []));
        accepted = true;
        clearSubmittedDraft(submittedKey, submittedRevision);
        setNotices(previous => ({ ...previous, [submittedKey]: queued ? 'Follow-up queued. Prime will pick it up after the current work finishes.' : 'Message accepted.' }));
        if (activeIdRef.current === target) {
          setFollow(true);
          await readMessages(target);
        }
      } else {
        const created = await window.prime.createSession({ prompt: text, cwd, ...(images?.length ? { images } : {}), ...(model ? { model } : {}), ...(requiresConsent ? { allowFileChanges } : {}) });
        accepted = true;
        clearSubmittedDraft(submittedKey, submittedRevision);
        setSessions(previous => [created, ...previous.filter(session => session.id !== created.id)]);
        if (activeIdRef.current === null) setActiveId(created.id);
      }
      await refresh();
    } catch (err) {
      setError(accepted ? `Message accepted, but the view could not refresh: ${errorText(err)}. Do not resend it.` : errorText(err));
    } finally { setPendingFor(submittedKey, false); } // Never move focus after an asynchronous operation.
  }
  async function changeModel(value: string) {
    if (!activeId) { setModel(value); return; }
    if (!active?.writable || pendingKeys.current.has(activeId)) return;
    const id = activeId; setPendingFor(id, true); setError('');
    try { await window.prime.setSessionModel(id, value); await refresh(); }
    catch (error) { setError(errorText(error)); } finally { setPendingFor(id, false); }
  }
  async function exportConversation(format: ExportFormat | 'copy') {
    if (!active) return;
    setMenuOpen(false);
    const key = active.id;
    try {
      if (format === 'copy') { await window.prime.copyText(conversationToMarkdown(active, messages)); setNotices(previous => ({ ...previous, [key]: 'Conversation copied as Markdown.' })); return; }
      const content = format === 'json' ? conversationToJson(active, messages) : conversationToMarkdown(active, messages);
      if (await window.prime.saveText(exportFileName(active.title, format), content)) setNotices(previous => ({ ...previous, [key]: `Conversation exported as ${format === 'json' ? 'JSON' : 'Markdown'}.` }));
    } catch (err) { setError(`Export: ${errorText(err)}`); }
  }
  async function stop() {
    if (!activeId || readOnly || pendingKeys.current.has(activeId)) return;
    const target = activeId; setPendingFor(target, true);
    try { await window.prime.interruptSession(target); await refresh(); }
    catch (err) { setError(errorText(err)); } finally { setPendingFor(target, false); }
  }
  async function confirmDialog(event: FormEvent) {
    event.preventDefault();
    if (!activeId || dialogPendingRef.current || readOnly) return;
    const target = activeId, operation = dialog;
    dialogPendingRef.current = true; setDialogPending(true);
    try {
      if (operation === 'close-owned') { await window.prime.closeOwnedSession(target); } else if (operation === 'delete') {
        await window.prime.deleteSession(target);
        setDrafts(previous => { const next = { ...previous }; delete next[target]; return next; });
        if (activeIdRef.current === target) newSession();
      } else if (operation === 'rename') {
        if (!renameTitle.trim()) return;
        await window.prime.renameSession(target, renameTitle.trim());
      }
      await refresh();
      if (dialogRef.current === operation) setDialog(null);
    } catch (err) { setError(`${operation === 'delete' ? 'Delete' : operation === 'close-owned' ? 'Close' : 'Rename'} session: ${errorText(err)}`); }
    finally { dialogPendingRef.current = false; setDialogPending(false); }
  }

  return <div className={`app-shell ${isElectron ? 'electron' : 'browser-preview'}`}>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}
    <aside ref={sidebarRef} inert={!!dialog || (narrow && !sidebarOpen)} aria-hidden={narrow && !sidebarOpen ? true : undefined} onKeyDown={event => { if (drawerOpen && event.key === 'Tab') { const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, [href]')).filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none'); const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }} className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="window-drag"><div className="window-dots" aria-hidden="true"><i /><i /><i /></div><span>SESSION DOCK</span></div>
      <div className="brand"><DockMark /><span className="brand-name">Session Dock</span><button className="icon-button mobile-close" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      <button className="new-session-button" onClick={newSession}><Plus size={17} /><span>New session</span><kbd>{newSessionShortcut}</kbd></button>
      <div className="sidebar-search"><Search size={15} /><input aria-label="Search sessions" placeholder="Search sessions..." value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}</div>
      <div className="workspace-label"><span>YOUR WORKSPACE</span><span className="count">{sessions.length}</span></div>
      <div className="sidebar-controls"><label>Group by<select aria-label="Group sessions by" value={meta.groupBy} onChange={event => updateMeta({ ...meta, groupBy: event.target.value === 'workspace' ? 'workspace' : 'date' })}><option value="date">Date</option><option value="workspace">Workspace</option></select></label>{knownTags.length > 0 && <div className="tag-filter" role="group" aria-label="Filter by tag">{knownTags.map(tag => <button key={tag} type="button" aria-pressed={tagFilter.toLowerCase() === tag.toLowerCase()} onClick={() => setTagFilter(tagFilter.toLowerCase() === tag.toLowerCase() ? '' : tag)}>{tag}</button>)}</div>}{metaStorageError && <p role="alert">Pins and tags could not be saved.</p>}</div>
      <nav className="session-list" aria-label="Sessions">
        {loading ? <div className="sidebar-empty"><LoaderCircle className="spin" size={16} /><span>Loading sessions...</span></div> : grouped.length ? grouped.map(([label, entries]) => <section className="session-group" key={label}><h2>{label}</h2>{entries.map(session => <button key={session.id} className={`session-item ${activeId === session.id ? 'selected' : ''}`} onClick={() => { setActiveId(session.id); setSidebarOpen(false); setMenuOpen(false); }} aria-current={activeId === session.id ? 'page' : undefined}>{meta.pinned.includes(session.id) ? <Pin size={15} aria-label="Pinned" /> : <MessageSquare size={15} />}<span className="session-item-text"><span>{session.title || 'Untitled session'}</span><small>{folderName(session.cwd)}{meta.tags[session.id]?.length ? ` · ${meta.tags[session.id].join(', ')}` : ''}</small></span>{session.status === 'running' ? <span className="running-dot" title="Running" aria-label="Running" /> : <time>{relativeTime(session.updatedAt)}</time>}</button>)}</section>) : <div className="sidebar-empty"><MessageSquare size={19} /><p>{search ? 'No matching sessions' : 'A fresh start.'}<small>{search ? 'Try another search.' : 'Your sessions will appear here.'}</small></p></div>}
      </nav>
      <div className="sidebar-bottom"><div className="local-note"><Terminal size={15} /><div><strong>Unofficial companion for Prime Agent</strong><span>Independent community project</span></div></div><button className="connection-button" onClick={reconnect} disabled={connecting} title={connection?.error || 'Reconnect to Prime Agent'}><span className={`status-dot ${connection?.connected ? 'connected' : ''}`} /><span>{connecting ? 'Connecting...' : connection?.connected ? 'Agent connected' : connection ? 'Agent disconnected' : 'Checking connection...'}</span>{connecting ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}</button><div className="sidebar-footer"><span>COMMUNITY BUILT</span><button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setDialog('settings')}><Settings size={16} /></button><button className="icon-button" aria-label="About Session Dock" onClick={() => setDialog('about')}><CircleHelp size={16} /></button></div></div>
    </aside>
    <main inert={!!dialog || drawerOpen} className="main-panel">
      <header className="topbar"><div className="breadcrumb"><button ref={sidebarToggle} className="icon-button sidebar-toggle" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button><span className="breadcrumb-root">Workspace</span><span className="breadcrumb-slash">/</span><strong>{active?.title || 'New session'}</strong>{running && <span className="header-running"><span className="running-dot" />Working{active?.queuedCount ? ` · ${active.queuedCount} queued` : ''}</span>}</div><div className="topbar-actions">{!isElectron && <span className="preview-badge">READ-ONLY PREVIEW</span>}<span className="local-badge"><span /> LOCAL</span>{active && <button className="icon-button" aria-label="Workspace files and changes" aria-pressed={workspaceOpen} title="Workspace files and changes" onClick={() => setWorkspaceOpen(!workspaceOpen)}><PanelRight size={19} /></button>}{active && <div className="session-menu"><button className="icon-button" aria-label="Session actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={20} /></button>{menuOpen && <><button className="menu-dismiss" aria-label="Close session actions" onClick={() => setMenuOpen(false)} /><div className="dropdown"><button onClick={() => { updateMeta(togglePin(meta, active.id)); setMenuOpen(false); }}>{meta.pinned.includes(active.id) ? <PinOff size={14} /> : <Pin size={14} />}{meta.pinned.includes(active.id) ? 'Unpin session' : 'Pin session'}</button><button onClick={() => { setTagInput((meta.tags[active.id] ?? []).join(', ')); setDialog('tags'); setMenuOpen(false); }}><Tag size={14} />Edit tags</button><button disabled={readOnly} onClick={() => { setRenameTitle(active.title); setDialog('rename'); setMenuOpen(false); }}><Pencil size={14} />Rename session</button><button disabled={!messages.length} onClick={() => void exportConversation('markdown')}><Download size={14} />Export as Markdown</button><button disabled={!messages.length} onClick={() => void exportConversation('json')}><Download size={14} />Export as JSON</button><button disabled={!messages.length} onClick={() => void exportConversation('copy')}><Copy size={14} />Copy as Markdown</button><button onClick={() => { setMenuOpen(false); void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err))); }}><FolderOpen size={14} />Reveal folder</button>{active.ownership === 'desktop' && active.lifecycle === 'open' && <button onClick={() => { setMenuOpen(false); setDialog('close-owned'); }}><Square size={14} />Close desktop session</button>}<button className="danger-text" disabled={readOnly || active.ownership === 'desktop'} onClick={() => { setDialog('delete'); setMenuOpen(false); }}><Trash2 size={14} />Delete session</button></div></>}</div>}<button className="icon-button help-button" aria-label="About this app" onClick={() => setDialog('about')}><CircleHelp size={18} /></button></div></header>
      {active && <div className="session-context"><button onClick={() => void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err)))} title={active.cwd}><Folder size={13} /><span>{active.cwd}</span></button><span className="context-separator" /><span><Zap size={12} />{active.model || 'CLI default'}</span></div>}
      {active?.ownership === 'desktop' && <div className="offline-banner">Desktop-owned · {active.lifecycle === 'open' ? 'Tools can change files. Quitting stops this session. Model changes may update CLI defaults.' : 'Closed — saved history is read-only.'}</div>}
      {active && <details className="queue-status"><summary>Work &amp; queue status</summary><p>{running ? 'Agent reports active work.' : 'Agent reports no active work.'} {pending ? 'A desktop request is awaiting confirmation.' : 'No desktop request is pending for this session.'}</p>{typeof active.queuedCount === 'number' ? <p>Agent reports {active.queuedCount === 0 ? 'no queued follow-ups' : `${active.queuedCount} queued follow-up${active.queuedCount === 1 ? '' : 's'}`}. Queued message text, ordering and cancellation are not available through this connection.</p> : <p>Authoritative queue details are unavailable with this daemon protocol. This is not an empty-queue report. View, edit, or cancel queued work in the CLI.</p>}{active.ownership === 'desktop' && active.writable && <SessionUsage key={active.id} sessionId={active.id} idle={!running && !pending && !active.queuedCount} onCompacted={() => void refresh()} onError={setError} />}</details>}
      {preferencesError && <div className="error-banner" role="alert">Workspace and model preferences could not be saved. They apply only to this window.</div>}
      {active?.ownership !== 'desktop' && connection?.readOnly && <div className="offline-banner" role="status">{connection?.canCreateOwned ? 'Shared CLI sessions are read-only. Start a new desktop-owned session to work with Prime.' : connection?.ownedReason || connection?.safetyReason}</div>}
      {error && <div className="error-banner" role="alert"><CircleHelp size={16} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {connection && !connection.connected && <div className="offline-banner"><span>{connection.error || 'Connect to Prime Agent to start working.'}</span><button onClick={reconnect} disabled={connecting}>{connecting ? 'Connecting...' : 'Start agent service / reconnect'}<RefreshCw size={12} className={connecting ? 'spin' : ''} /></button></div>}
      <div className={`content-scroll ${!activeId ? 'welcome-scroll' : ''}`} ref={scrollArea} onScroll={() => { const node = scrollArea.current; if (!node) return; if (node.scrollHeight - node.scrollTop - node.clientHeight < 100) setFollow(true); else if (node.scrollTop < lastScrollTop.current) setFollow(false); lastScrollTop.current = node.scrollTop; }}>
        {!activeId ? <div className="welcome"><div className="welcome-eyebrow"><span className="eyebrow-line" /> A LITTLE DIRECTION. ENDLESS POSSIBILITY.</div><div className="hero-mark"><DockMark /><span className="hero-spark"><Sparkles size={15} /></span></div><h1>Good ideas deserve<br />a <span>head start.</span></h1><p className="welcome-description">Meet your coding partner. Build, explore, and solve<br className="desktop-break" /> together, right from your workspace.</p><div className="starter-heading"><span>WHERE SHOULD WE START?</span><span>Pick a direction, or make your own<ArrowDown size={12} /></span></div><div className="starter-grid">{starters.map(({ icon: Icon, title, description, prompt }) => <button key={title} className="starter-card" onClick={() => { setDraft(prompt); textarea.current?.focus(); }}><div className="starter-icon"><Icon size={20} /><ArrowRight size={15} /></div><strong>{title}</strong><span>{description}</span></button>)}</div><div className="welcome-note"><FolderOpen size={14} /><span>Start in a project folder. Prime takes it from there.</span></div><p className="safety-note">Agents run with your user permissions. No sandbox.</p></div> : <div className="conversation" ref={conversationRef}>{loadingMessages ? <div className="messages-loading"><LoaderCircle size={18} className="spin" />Loading conversation...</div> : messages.length ? <>{messages.length > visibleMessages && <button className="secondary-button" onClick={() => { setFollow(false); setVisibleMessages(count => count + 100); }}>Load earlier messages ({messages.length - visibleMessages})</button>}{conversationItems.map((item, index) => item.kind === 'trace' ? <TraceView key={item.id} steps={item.steps} active={running && index === conversationItems.length - 1} /> : <MessageView key={item.message.id} message={item.message} animate={!!knownIds.current && !knownIds.current.has(item.message.id)} />)}</> : <div className="conversation-empty"><MessageSquare size={26} /><h2>The next step is yours.</h2><p>Send a message to continue this session.</p></div>}{running && <div className="working-indicator" role="status"><DockMark /><span>Prime is working<span className="thinking-dots"><i /><i /><i /></span></span></div>}{active?.status === 'error' && <div className="system-message"><CircleHelp size={15} />This session stopped with an error. Check its history before retrying. Closed or uncertain desktop sessions cannot accept new prompts.</div>}</div>}
        {activeId && showJump && <div className="jump-latest-anchor"><button type="button" className="jump-latest" onClick={() => { setFollow(true); if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight; }}><ArrowDown size={13} />Jump to latest</button></div>}
      </div>
      <div className={`composer-area ${!activeId ? 'welcome-composer' : ''}`}>{requiresConsent && <label className="workspace-consent"><input type="checkbox" checked={allowFileChanges} onChange={event => setAllowFileChanges(event.target.checked)} />I trust this workspace. Prime may run tools and change files with my user permissions. This is not a sandbox.</label>}<form className={`composer ${pending ? 'is-pending' : ''}`} onSubmit={submit}><DraftImages images={draftImages} onRemove={removeImage} />{draftEntry?.attachmentError && <p className="attachment-error" role="alert">{draftEntry.attachmentError}</p>}<label className="sr-only" htmlFor="prompt">Message Prime</label><textarea id="prompt" ref={textarea} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder={running ? 'Queue a follow-up for after this work...' : activeId ? 'What’s next? Ask Prime anything...' : 'What would you like to work on?'} rows={2} /><div className="composer-toolbar"><div className="composer-controls"><ImagePicker disabled={!canAttach || pending} busy={reading} reason={attachmentReason} onFiles={files => void addImages(files)} /><button type="button" className="folder-control" onClick={() => { if (active) void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err))); else void chooseFolder(); }} title={currentCwd || 'Choose project folder'}><Folder size={14} /><span>{folderName(currentCwd)}</span>{!active && <ChevronDown size={12} />}</button><span className="control-divider" />{!active && <input className="model-search" aria-label="Search models" placeholder="Find model…" value={modelSearch} onChange={event => setModelSearch(event.target.value)} />}<label className="model-control"><Zap size={13} /><span className="sr-only">Model</span><select aria-label="Model" value={active ? active.model || '' : model} disabled={!!active && (!active.writable || running || pending)} onChange={event => void changeModel(event.target.value)}><option value="">CLI default</option>{!active && model && !models.some(choice => choice.id === model) && <option value={model}>{model} (saved selection)</option>}{active?.model && !models.some(choice => choice.id === active.model) && <option value={active.model}>{active.model}</option>}{models.filter(choice => active || choice.id === model || `${choice.id} ${choice.name}`.toLowerCase().includes(modelSearch.toLowerCase())).map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>{!active && <ChevronDown size={11} />}</label></div><div className="send-controls">{pending && <span className="sending-label">Sending...</span>}{running && <button type="button" className="send-button stop-button" aria-label="Stop generation" title="Stop generation" onClick={stop} disabled={pending || readOnly || !readyToSend}><Square size={13} fill="currentColor" /></button>}<button className="send-button" type="submit" aria-label={running ? 'Queue follow-up' : 'Send message'} title={running ? 'Queue for after current work (Enter)' : 'Send message (Enter)'} disabled={readOnly || (!draft.trim() && !draftImages.length) || pending || reading || !readyToSend || (!active && !cwd) || (requiresConsent && !allowFileChanges)}>{pending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={19} />}</button></div></div></form><div className="composer-caption"><span role="status" title={notice}><span className="privacy-dot" />{notice || (running ? 'Follow-ups wait until current work finishes.' : 'Drafts stay in memory, not on disk.')}</span><span><kbd>↵</kbd> {running ? 'to queue' : 'to send'} <span className="caption-dot">·</span> <kbd>shift ↵</kbd> for a new line</span></div></div>
      <footer className="main-footer"><span>MADE FOR YOUR NEXT BIG THING.</span><span>Build with intention.<DockMark /></span></footer>
    </main>
    {active && workspaceOpen && <div className="workspace-slot" inert={!!dialog}><WorkspacePanel sessionId={active.id} cwd={active.cwd} running={running} canEdit={active.ownership === 'desktop'} onClose={() => setWorkspaceOpen(false)} /></div>}
    {dialog && <div className="modal-backdrop" onClick={() => { if (!dialogPending) setDialog(null); }}><section className={`modal ${dialog === 'settings' ? 'settings-modal' : dialog === 'palette' ? 'palette-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Tab') { const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary')).filter(node => node.checkVisibility() && !node.closest('[inert]'));  const first = elements[0]; const last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}><button className="modal-close icon-button" aria-label="Close dialog" onClick={() => setDialog(null)} disabled={dialogPending}><X size={18} /></button>{dialog === 'settings' ? <><AppearanceSettings appearance={appearance} onChange={changeAppearance} onClose={() => setDialog(null)} storageError={appearanceStorageError} /><DisplaySettings /><ProviderSettings onModelsChanged={setModels} /><ConnectionSettings onConnect={reconnect} /></> : dialog === 'palette' ? <CommandPalette commands={commands} onPick={command => { setDialog(null); command.run(); }} /> : dialog === 'tags' && active ? <form onSubmit={event => { event.preventDefault(); updateMeta(setTags(meta, active.id, normalizeTags(tagInput))); setDialog(null); }}><div className="modal-icon"><Tag size={22} /></div><h2 id="dialog-title">Edit tags</h2><p>Tags are kept only in this app to help you find sessions. Separate them with commas (up to {MAX_TAGS}, {MAX_TAG_LENGTH} characters each).</p><input className="rename-input" aria-label="Tags" value={tagInput} onChange={event => setTagInput(event.target.value)} autoFocus placeholder="bug, refactor, urgent" /><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary-button">Save tags</button></div></form> : dialog === 'about' ? <><div className="about-logo"><DockMark />Session Dock</div><h2 id="dialog-title">Your agent. At home on your desktop.</h2><p>Session Dock is an unofficial companion for Prime Agent CLI. It is not affiliated with or endorsed by Prime Intellect.</p><p>Your sessions and tools run on your machine using your existing CLI configuration. Prime Agent is a separate project and must be installed independently.</p><div className="about-detail"><Terminal size={15} />{connection?.version ? `Prime Agent ${connection.version}` : 'Prime Agent CLI'}<span>{connection?.connected ? 'Connected' : 'Disconnected'}</span></div><ThirdPartyNotices /><p className="about-shortcut">New session <kbd>{newSessionShortcut}</kbd><br />Command palette <kbd>{paletteShortcut}</kbd><br />Send a message <kbd>Enter</kbd><br />Insert a new line <kbd>Shift + Enter</kbd></p><button className="primary-button" autoFocus onClick={() => setDialog(null)}>Let’s build<ArrowRight size={15} /></button></> : dialog === 'close-owned' ? <form onSubmit={confirmDialog}><h2 id="dialog-title">Close desktop session?</h2><p>This stops its owned agent process and queued work. Saved history stays available, but this version cannot resume closed desktop sessions. Shared CLI sessions and independently created agents are not stopped.</p><div className="modal-actions"><button type="button" className="secondary-button" disabled={dialogPending} onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="danger-button" disabled={dialogPending}>Close and stop</button></div></form> : <form onSubmit={confirmDialog}><div className={`modal-icon ${dialog === 'delete' ? 'destructive' : ''}`}>{dialog === 'delete' ? <Trash2 size={22} /> : <Pencil size={22} />}</div><h2 id="dialog-title">{dialog === 'delete' ? 'Delete this session?' : 'Rename session'}</h2><p>{dialog === 'delete' ? `“${active?.title || 'This session'}” will be permanently deleted from your shared CLI history. Its active worker will be stopped. This cannot be undone.` : 'Give this conversation a name that’s easy to find.'}</p>{dialog === 'rename' && <input className="rename-input" aria-label="Session title" value={renameTitle} onChange={event => setRenameTitle(event.target.value)} autoFocus maxLength={200} required />}<div className="modal-actions"><button type="button" className="secondary-button" autoFocus={dialog === 'delete'} onClick={() => setDialog(null)} disabled={dialogPending}>Cancel</button><button type="submit" className={dialog === 'delete' ? 'danger-button' : 'primary-button'} disabled={dialogPending || (dialog === 'rename' && !renameTitle.trim())}>{dialogPending && <LoaderCircle className="spin" size={14} />}{dialog === 'delete' ? 'Delete session' : 'Save name'}</button></div></form>}</section></div>}
  </div>;
}
