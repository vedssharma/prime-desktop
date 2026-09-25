import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Copy, Folder, FolderOpen, GitBranch, LoaderCircle, Menu, MessageSquare, MoreHorizontal, PanelLeftClose, Plus, RefreshCw, Search, Sparkles, Square, Settings, Terminal, Trash2, X, Pencil, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConnectionStatus, Message, ModelOption, Session } from '../shared/types';
import './styles.css';
import { loadPreferences, savePreferences } from './preferences';
import AppearanceSettings from './AppearanceSettings';
import ThirdPartyNotices from './ThirdPartyNotices';
import ConnectionSettings from './ConnectionSettings';
import DisplaySettings from './DisplaySettings';
import { groupConversation } from './trace';
import { useRevealedText } from './reveal';
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from './appearance';

const isElectron = navigator.userAgent.includes('Electron');
const starters = [
  { icon: Code2, title: 'Build something new', description: 'Turn an idea into working code', prompt: 'Help me build a new project. First, ask me about what I want to create.' },
  { icon: Search, title: 'Explore a codebase', description: 'Find your way around a project', prompt: 'Explore this codebase and explain its structure, key components, and how to get started.' },
  { icon: GitBranch, title: 'Make it better', description: 'Find bugs and thoughtful improvements', prompt: 'Review this project for bugs and opportunities to improve it. Explain your findings before making changes.' },
];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const folderName = (path: string) => path.replace(/[\\/]$/, '').split(/[\\/]/).pop() || path || 'Choose a folder';
const relativeTime = (value: string) => { const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); return mins < 1 ? 'now' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`; };
function DockMark({ className = '' }: { className?: string }) { return <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="7" y="4" width="18" height="15" rx="3" stroke="currentColor" strokeWidth="2.5" /><path d="m11 9 3 3-3 3m7 0h3M4 20v5a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3v-5M4 21h7l2 3h6l2-3h7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
const MessageView = memo(function MessageView({ message, animate = false }: { message: Message; animate?: boolean }) {
  const [copied, setCopied] = useState(false);
  const revealed = useRevealedText(message.content, animate && message.role === 'assistant');
  const [copyError, setCopyError] = useState('');
  if (message.role === 'tool') return <details className="tool-message"><summary><Terminal size={14} /><span>{message.toolName || 'Tool call'}</span><ChevronRight size={14} /></summary><pre>{message.content || 'No output'}</pre></details>;
  if (message.role === 'system') return <div className="system-message"><CircleHelp size={14} /><span>{message.content}</span></div>;
  return <article className={`message ${message.role}`}><div className={`message-avatar ${message.role === 'assistant' ? 'agent-avatar' : ''}`}>{message.role === 'assistant' ? <DockMark /> : 'Y'}</div><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Prime' : 'You'}</strong>{message.role === 'assistant' && <span className="agent-label">AGENT</span>}{message.timestamp && <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt, src }) => <a href={src} target="_blank" rel="noreferrer">[Image: {alt || 'View image'}]</a> }}>{revealed}</ReactMarkdown></div>{message.role === 'assistant' && <button className="copy-message icon-button" aria-label={copied ? 'Response copied' : 'Copy response'} title="Copy response" onClick={() => { setCopyError(''); void window.prime.copyText(message.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(error => setCopyError(`Copy failed: ${errorText(error)}`)); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}{copyError && <p role="alert">{copyError}</p>}</div></article>;
}, (a, b) => a.message.id === b.message.id && a.message.content === b.message.content && a.message.role === b.message.role && a.message.timestamp === b.message.timestamp && a.message.toolName === b.message.toolName);
const TraceView = memo(function TraceView({ steps, active }: { steps: Message[]; active: boolean }) {
  const calls = steps.filter(step => step.role === 'tool').length;
  const label = `${calls} tool ${calls === 1 ? 'call' : 'calls'}`;
  return <details className="trace"><summary>{active ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}<span className="trace-title">{active ? 'Working' : 'Thought process'}</span><span className="trace-count">{label}</span><ChevronRight size={14} /></summary><div className="trace-steps">{steps.map(step => step.role === 'tool' ? <details key={step.id} className="tool-message"><summary><Terminal size={14} /><span>{step.toolName || 'Tool call'}</span><ChevronRight size={14} /></summary><pre>{step.content || 'No output'}</pre></details> : step.role === 'system' ? <div key={step.id} className="system-message"><CircleHelp size={14} /><span>{step.content}</span></div> : <div key={step.id} className="trace-note markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt, src }) => <a href={src} target="_blank" rel="noreferrer">[Image: {alt || 'View image'}]</a> }}>{step.content}</ReactMarkdown></div>)}</div></details>;
}, (a, b) => a.active === b.active && a.steps.length === b.steps.length && a.steps.every((step, i) => step.id === b.steps[i].id && step.content === b.steps[i].content && step.toolName === b.steps[i].toolName));

export default function App() {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [visibleMessages, setVisibleMessages] = useState(100);
  const [search, setSearch] = useState('');
  const [preferences] = useState(loadPreferences);
  const [drafts, setDrafts] = useState<Record<string, { text: string; revision: number }>>({});
  const draftKey = activeId ?? 'new-session';
  const draftEntry = drafts[draftKey];
  const draft = draftEntry?.text ?? '';
  const setDraft = (text: string) => setDrafts(previous => ({ ...previous, [draftKey]: { text, revision: (previous[draftKey]?.revision ?? 0) + 1 } }));
  const clearSubmittedDraft = (key: string, revision: number | undefined) => setDrafts(previous => {
    if (previous[key]?.revision !== revision) return previous;
    return { ...previous, [key]: { text: '', revision: (revision ?? 0) + 1 } };
  });
  const [cwd, setCwd] = useState(preferences.cwd);
  const [model, setModel] = useState(preferences.model);
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
  const [dialog, setDialog] = useState<'rename' | 'delete' | 'about' | 'settings' | null>(null);
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
  // Content growing below the viewport is not the user scrolling away; only an upward scroll stops following.
  const lastScrollTop = useRef(0);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const active = sessions.find(session => session.id === activeId);
  const running = active?.status === 'running';
  const readOnly = connection?.readOnly === true;
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
        if (status.connected) {
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
    if (!connection?.connected) return;
    let cancelled = false;
    void window.prime.listModels().then(choices => { if (!cancelled) setModels(choices); }).catch(error => { if (!cancelled) setError(`Model discovery: ${errorText(error)}`); });
    return () => { cancelled = true; };
  }, [connection?.connected]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const status = await window.prime.status();
        if (!stopped) setConnection(status);
        if (status.connected) {
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
    setMessages([]); setVisibleMessages(100); followBottom.current = true; knownIds.current = null;
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

  useEffect(() => { if (followBottom.current && scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight; }, [messages, running]);
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
  const newSession = useCallback(() => { setActiveId(null); setSidebarOpen(false); setMenuOpen(false); setTimeout(() => { if (!dialogRef.current && activeIdRef.current === null) textarea.current?.focus(); }, 50); }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!dialogRef.current) newSession(); } if (event.key === 'Escape') { if (dialogPendingRef.current) return; setDialog(null); setMenuOpen(false); setSidebarOpen(false); } };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [newSession]);

  const grouped = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const groups: Record<string, Session[]> = { 'Today': [], 'Previous 7 days': [], 'Earlier': [] };
    [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(session => `${session.title} ${session.cwd}`.toLowerCase().includes(search.toLowerCase())).forEach(session => { const age = today.getTime() - new Date(session.updatedAt).getTime(); groups[age <= 0 ? 'Today' : age < 7 * 86400000 ? 'Previous 7 days' : 'Earlier'].push(session); });
    return Object.entries(groups).filter(([, entries]) => entries.length);
  }, [sessions, search]);

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
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (readOnly || dialogRef.current || !text || pendingKeys.current.has(draftKey) || !connection?.connected || (!activeId && !cwd)) return;
    const target = activeId;
    const submittedKey = draftKey;
    const submittedRevision = draftEntry?.revision;
    const queued = !!target && running;
    setPendingFor(submittedKey, true); setError('');
    setNotices(previous => ({ ...previous, [submittedKey]: '' }));
    let accepted = false;
    try {
      if (target) {
        await window.prime.sendMessage(target, text);
        accepted = true;
        clearSubmittedDraft(submittedKey, submittedRevision);
        setNotices(previous => ({ ...previous, [submittedKey]: queued ? 'Follow-up queued. Prime will pick it up after the current work finishes.' : 'Message accepted.' }));
        if (activeIdRef.current === target) {
          followBottom.current = true;
          await readMessages(target);
        }
      } else {
        const created = await window.prime.createSession({ prompt: text, cwd, ...(model ? { model } : {}) });
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
      if (operation === 'delete') {
        await window.prime.deleteSession(target);
        setDrafts(previous => { const next = { ...previous }; delete next[target]; return next; });
        if (activeIdRef.current === target) newSession();
      } else if (operation === 'rename') {
        if (!renameTitle.trim()) return;
        await window.prime.renameSession(target, renameTitle.trim());
      }
      await refresh();
      if (dialogRef.current === operation) setDialog(null);
    } catch (err) { setError(`${operation === 'delete' ? 'Delete' : 'Rename'} session: ${errorText(err)}`); }
    finally { dialogPendingRef.current = false; setDialogPending(false); }
  }

  return <div className={`app-shell ${isElectron ? 'electron' : 'browser-preview'}`}>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}
    <aside ref={sidebarRef} inert={!!dialog || (narrow && !sidebarOpen)} aria-hidden={narrow && !sidebarOpen ? true : undefined} onKeyDown={event => { if (drawerOpen && event.key === 'Tab') { const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, [href]')).filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none'); const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }} className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="window-drag"><div className="window-dots" aria-hidden="true"><i /><i /><i /></div><span>SESSION DOCK</span></div>
      <div className="brand"><DockMark /><span className="brand-name">Session Dock</span><button className="icon-button mobile-close" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      <button className="new-session-button" onClick={newSession}><Plus size={17} /><span>New session</span><kbd>⌘ N</kbd></button>
      <div className="sidebar-search"><Search size={15} /><input aria-label="Search sessions" placeholder="Search sessions..." value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}</div>
      <div className="workspace-label"><span>YOUR WORKSPACE</span><span className="count">{sessions.length}</span></div>
      <nav className="session-list" aria-label="Sessions">
        {loading ? <div className="sidebar-empty"><LoaderCircle className="spin" size={16} /><span>Loading sessions...</span></div> : grouped.length ? grouped.map(([label, entries]) => <section className="session-group" key={label}><h2>{label}</h2>{entries.map(session => <button key={session.id} className={`session-item ${activeId === session.id ? 'selected' : ''}`} onClick={() => { setActiveId(session.id); setSidebarOpen(false); setMenuOpen(false); }} aria-current={activeId === session.id ? 'page' : undefined}><MessageSquare size={15} /><span className="session-item-text"><span>{session.title || 'Untitled session'}</span><small>{folderName(session.cwd)}</small></span>{session.status === 'running' ? <span className="running-dot" title="Running" aria-label="Running" /> : <time>{relativeTime(session.updatedAt)}</time>}</button>)}</section>) : <div className="sidebar-empty"><MessageSquare size={19} /><p>{search ? 'No matching sessions' : 'A fresh start.'}<small>{search ? 'Try another search.' : 'Your sessions will appear here.'}</small></p></div>}
      </nav>
      <div className="sidebar-bottom"><div className="local-note"><Terminal size={15} /><div><strong>Unofficial companion for Prime Agent</strong><span>Independent community project</span></div></div><button className="connection-button" onClick={reconnect} disabled={connecting} title={connection?.error || 'Reconnect to Prime Agent'}><span className={`status-dot ${connection?.connected ? 'connected' : ''}`} /><span>{connecting ? 'Connecting...' : connection?.connected ? 'Agent connected' : connection ? 'Agent disconnected' : 'Checking connection...'}</span>{connecting ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}</button><div className="sidebar-footer"><span>COMMUNITY BUILT</span><button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setDialog('settings')}><Settings size={16} /></button><button className="icon-button" aria-label="About Session Dock" onClick={() => setDialog('about')}><CircleHelp size={16} /></button></div></div>
    </aside>
    <main inert={!!dialog || drawerOpen} className="main-panel">
      <header className="topbar"><div className="breadcrumb"><button ref={sidebarToggle} className="icon-button sidebar-toggle" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button><span className="breadcrumb-root">Workspace</span><span className="breadcrumb-slash">/</span><strong>{active?.title || 'New session'}</strong>{running && <span className="header-running"><span className="running-dot" />Working</span>}</div><div className="topbar-actions">{!isElectron && <span className="preview-badge">READ-ONLY PREVIEW</span>}<span className="local-badge"><span /> LOCAL</span>{active && <div className="session-menu"><button className="icon-button" aria-label="Session actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={20} /></button>{menuOpen && <><button className="menu-dismiss" aria-label="Close session actions" onClick={() => setMenuOpen(false)} /><div className="dropdown"><button disabled={readOnly} onClick={() => { setRenameTitle(active.title); setDialog('rename'); setMenuOpen(false); }}><Pencil size={14} />Rename session</button><button onClick={() => { setMenuOpen(false); void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err))); }}><FolderOpen size={14} />Reveal folder</button><button className="danger-text" disabled={readOnly} onClick={() => { setDialog('delete'); setMenuOpen(false); }}><Trash2 size={14} />Delete session</button></div></>}</div>}<button className="icon-button help-button" aria-label="About this app" onClick={() => setDialog('about')}><CircleHelp size={18} /></button></div></header>
      {active && <div className="session-context"><button onClick={() => void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err)))} title={active.cwd}><Folder size={13} /><span>{active.cwd}</span></button><span className="context-separator" /><span><Zap size={12} />{active.model || 'CLI default'}</span></div>}
      {active && <details className="queue-status"><summary>Work &amp; queue status</summary><p>{running ? 'Agent reports active work.' : 'Agent reports no active work.'} {pending ? 'A desktop request is awaiting confirmation.' : 'No desktop request is pending for this session.'}</p><p>Authoritative queue details are unavailable with this daemon protocol. This is not an empty-queue report. View, edit, or cancel queued work in the CLI.</p></details>}
      {preferencesError && <div className="error-banner" role="alert">Workspace and model preferences could not be saved. They apply only to this window.</div>}
      {readOnly && <div className="offline-banner" role="status">{connection?.safetyReason}</div>}
      {error && <div className="error-banner" role="alert"><CircleHelp size={16} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {connection && !connection.connected && <div className="offline-banner"><span>{connection.error || 'Connect to Prime Agent to start working.'}</span><button onClick={reconnect} disabled={connecting}>{connecting ? 'Connecting...' : 'Start agent service / reconnect'}<RefreshCw size={12} className={connecting ? 'spin' : ''} /></button></div>}
      <div className={`content-scroll ${!activeId ? 'welcome-scroll' : ''}`} ref={scrollArea} onScroll={() => { const node = scrollArea.current; if (!node) return; if (node.scrollHeight - node.scrollTop - node.clientHeight < 100) followBottom.current = true; else if (node.scrollTop < lastScrollTop.current) followBottom.current = false; lastScrollTop.current = node.scrollTop; }}>
        {!activeId ? <div className="welcome"><div className="welcome-eyebrow"><span className="eyebrow-line" /> A LITTLE DIRECTION. ENDLESS POSSIBILITY.</div><div className="hero-mark"><DockMark /><span className="hero-spark"><Sparkles size={15} /></span></div><h1>Good ideas deserve<br />a <span>head start.</span></h1><p className="welcome-description">Meet your coding partner. Build, explore, and solve<br className="desktop-break" /> together, right from your workspace.</p><div className="starter-heading"><span>WHERE SHOULD WE START?</span><span>Pick a direction, or make your own<ArrowDown size={12} /></span></div><div className="starter-grid">{starters.map(({ icon: Icon, title, description, prompt }) => <button key={title} className="starter-card" onClick={() => { setDraft(prompt); textarea.current?.focus(); }}><div className="starter-icon"><Icon size={20} /><ArrowRight size={15} /></div><strong>{title}</strong><span>{description}</span></button>)}</div><div className="welcome-note"><FolderOpen size={14} /><span>Start in a project folder. Prime takes it from there.</span></div><p className="safety-note">Agents run with your user permissions. No sandbox.</p></div> : <div className="conversation" ref={conversationRef}>{loadingMessages ? <div className="messages-loading"><LoaderCircle size={18} className="spin" />Loading conversation...</div> : messages.length ? <>{messages.length > visibleMessages && <button className="secondary-button" onClick={() => { followBottom.current = false; setVisibleMessages(count => count + 100); }}>Load earlier messages ({messages.length - visibleMessages})</button>}{conversationItems.map((item, index) => item.kind === 'trace' ? <TraceView key={item.id} steps={item.steps} active={running && index === conversationItems.length - 1} /> : <MessageView key={item.message.id} message={item.message} animate={!!knownIds.current && !knownIds.current.has(item.message.id)} />)}</> : <div className="conversation-empty"><MessageSquare size={26} /><h2>The next step is yours.</h2><p>Send a message to continue this session.</p></div>}{running && <div className="working-indicator" role="status"><DockMark /><span>Prime is working<span className="thinking-dots"><i /><i /><i /></span></span></div>}{active?.status === 'error' && <div className="system-message"><CircleHelp size={15} />This session stopped with an error. Send a message to try again.</div>}</div>}
      </div>
      <div className={`composer-area ${!activeId ? 'welcome-composer' : ''}`}><form className={`composer ${pending ? 'is-pending' : ''}`} onSubmit={submit}><label className="sr-only" htmlFor="prompt">Message Prime</label><textarea id="prompt" ref={textarea} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder={running ? 'Queue a follow-up for after this work...' : activeId ? 'What’s next? Ask Prime anything...' : 'What would you like to work on?'} rows={2} /><div className="composer-toolbar"><div className="composer-controls"><button type="button" className="folder-control" onClick={() => { if (active) void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err))); else void chooseFolder(); }} title={currentCwd || 'Choose project folder'}><Folder size={14} /><span>{folderName(currentCwd)}</span>{!active && <ChevronDown size={12} />}</button><span className="control-divider" />{!active && <input className="model-search" aria-label="Search models" placeholder="Find model…" value={modelSearch} onChange={event => setModelSearch(event.target.value)} />}<label className="model-control"><Zap size={13} /><span className="sr-only">Model</span><select aria-label="Model" value={active ? active.model || '' : model} disabled={!!active} onChange={event => setModel(event.target.value)}><option value="">CLI default</option>{!active && model && !models.some(choice => choice.id === model) && <option value={model}>{model} (saved selection)</option>}{active?.model && !models.some(choice => choice.id === active.model) && <option value={active.model}>{active.model}</option>}{models.filter(choice => choice.id === model || `${choice.id} ${choice.name}`.toLowerCase().includes(modelSearch.toLowerCase())).map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>{!active && <ChevronDown size={11} />}</label></div><div className="send-controls">{pending && <span className="sending-label">Sending...</span>}{running && <button type="button" className="send-button stop-button" aria-label="Stop generation" title="Stop generation" onClick={stop} disabled={pending || readOnly || !connection?.connected}><Square size={13} fill="currentColor" /></button>}<button className="send-button" type="submit" aria-label={running ? 'Queue follow-up' : 'Send message'} title={running ? 'Queue for after current work (Enter)' : 'Send message (Enter)'} disabled={readOnly || !draft.trim() || pending || !connection?.connected || (!active && !cwd)}>{pending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={19} />}</button></div></div></form><div className="composer-caption"><span role="status" title={notice}><span className="privacy-dot" />{notice || (running ? 'Follow-ups wait until current work finishes.' : 'Drafts stay in memory, not on disk.')}</span><span><kbd>↵</kbd> {running ? 'to queue' : 'to send'} <span className="caption-dot">·</span> <kbd>shift ↵</kbd> for a new line</span></div></div>
      <footer className="main-footer"><span>MADE FOR YOUR NEXT BIG THING.</span><span>Build with intention.<DockMark /></span></footer>
    </main>
    {dialog && <div className="modal-backdrop" onClick={() => { if (!dialogPending) setDialog(null); }}><section className={`modal ${dialog === 'settings' ? 'settings-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Tab') { const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary')).filter(node => node.checkVisibility() && !node.closest('[inert]'));  const first = elements[0]; const last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}><button className="modal-close icon-button" aria-label="Close dialog" onClick={() => setDialog(null)} disabled={dialogPending}><X size={18} /></button>{dialog === 'settings' ? <><AppearanceSettings appearance={appearance} onChange={changeAppearance} onClose={() => setDialog(null)} storageError={appearanceStorageError} /><DisplaySettings /><ConnectionSettings onConnect={reconnect} /></> : dialog === 'about' ? <><div className="about-logo"><DockMark />Session Dock</div><h2 id="dialog-title">Your agent. At home on your desktop.</h2><p>Session Dock is an unofficial companion for Prime Agent CLI. It is not affiliated with or endorsed by Prime Intellect.</p><p>Your sessions and tools run on your machine using your existing CLI configuration. Prime Agent is a separate project and must be installed independently.</p><div className="about-detail"><Terminal size={15} />{connection?.version ? `Prime Agent ${connection.version}` : 'Prime Agent CLI'}<span>{connection?.connected ? 'Connected' : 'Disconnected'}</span></div><ThirdPartyNotices /><p className="about-shortcut">New session <kbd>⌘ / Ctrl + N</kbd><br />Send a message <kbd>Enter</kbd><br />Insert a new line <kbd>Shift + Enter</kbd></p><button className="primary-button" autoFocus onClick={() => setDialog(null)}>Let’s build<ArrowRight size={15} /></button></> : <form onSubmit={confirmDialog}><div className={`modal-icon ${dialog === 'delete' ? 'destructive' : ''}`}>{dialog === 'delete' ? <Trash2 size={22} /> : <Pencil size={22} />}</div><h2 id="dialog-title">{dialog === 'delete' ? 'Delete this session?' : 'Rename session'}</h2><p>{dialog === 'delete' ? `“${active?.title || 'This session'}” will be permanently deleted from your shared CLI history. Its active worker will be stopped. This cannot be undone.` : 'Give this conversation a name that’s easy to find.'}</p>{dialog === 'rename' && <input className="rename-input" aria-label="Session title" value={renameTitle} onChange={event => setRenameTitle(event.target.value)} autoFocus maxLength={200} required />}<div className="modal-actions"><button type="button" className="secondary-button" autoFocus={dialog === 'delete'} onClick={() => setDialog(null)} disabled={dialogPending}>Cancel</button><button type="submit" className={dialog === 'delete' ? 'danger-button' : 'primary-button'} disabled={dialogPending || (dialog === 'rename' && !renameTitle.trim())}>{dialogPending && <LoaderCircle className="spin" size={14} />}{dialog === 'delete' ? 'Delete session' : 'Save name'}</button></div></form>}</section></div>}
  </div>;
}
