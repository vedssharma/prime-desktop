import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, CircleHelp, Folder, RefreshCw, X, Zap } from 'lucide-react';
import type { ConnectionStatus, Message, ModelOption, Session, ImageAttachment } from '../shared/types';
import './styles.css';
import { loadPreferences, savePreferences } from './preferences';
import AppearanceSettings from './AppearanceSettings';
import ConnectionSettings from './ConnectionSettings';
import DisplaySettings from './DisplaySettings';
import ProviderSettings from './ProviderSettings';
import { groupConversation } from './trace';
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from './appearance';
import { conversationToJson, conversationToMarkdown, exportFileName, type ExportFormat } from './export';
import { finishedSessions, loadNotify, notificationFor } from './notify';
import WorkspacePanel from './WorkspacePanel';
import SessionUsage from './SessionUsage';
import CommandPalette from './CommandPalette';
import type { Command } from './commands';
import { allTags, groupSessions, loadSessionMeta, saveSessionMeta, togglePin, type SessionMeta } from './sessionMeta';
import { readImageFiles, type DraftImage } from './attachments';
import { validateImages, promptCommand } from '../electron/attachments';
import { errorText, folderName } from './format';
import { isElectron, newSessionShortcut } from './platform';
import { mergeStream } from './stream';
import DockMark from './DockMark';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import Welcome from './Welcome';
import Conversation from './Conversation';
import Composer from './Composer';
import { Modal, TagsDialog, AboutDialog, HistoryDialog, CloseOwnedDialog, RenameDeleteDialog, type DialogKind } from './Dialogs';

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
    const toggle = sidebarToggle.current;
    return () => { toggle?.focus(); };
  }, [drawerOpen]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
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
  const [historyConsent, setHistoryConsent] = useState(false);
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
  // Desktop-owned sessions push streamed output, so their transcript poll is only a safety net.
  const pushed = active?.ownership === 'desktop' && typeof window.prime.onSessionEvent === 'function';
  const pushedRef = useRef(pushed); pushedRef.current = pushed;
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
      finally { if (!cancelled) { setLoadingMessages(false); clearTimeout(timer); timer = setTimeout(poll, runningRef.current ? pushedRef.current ? 3000 : 600 : 10000); } }
    }
    // A run that starts while the idle timer is pending must not wait out the idle delay.
    pollMessagesNow.current = () => { if (!cancelled) { clearTimeout(timer); void poll(); } };
    void poll();
    // messageRead is a request counter, not a DOM node: bumping its live value invalidates in-flight reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  useEffect(() => window.prime.onSessionEvent?.(event => {
    if (event.type === 'activity') void refresh().catch(() => {});
    if (event.sessionId !== activeIdRef.current) return;
    if (event.type === 'stream') setMessages(previous => mergeStream(previous, event.streamId, event.messages));
    else pollMessagesNow.current();
  }), [refresh]);
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
  const [forkEntryId, setForkEntryId] = useState('');
  function showHistoryAction(operation: 'resume-owned' | 'fork-owned') {
    setForkEntryId(''); setHistoryConsent(false); setError(''); setMenuOpen(false); setDialog(operation);
  }
  async function confirmHistory(event: FormEvent) {
    event.preventDefault();
    if (!activeId || active?.ownership !== 'desktop' || active.lifecycle !== 'closed' || !historyConsent || dialogPendingRef.current || !connection?.canCreateOwned) return;
    const target = activeId, operation = dialog;
    if (operation !== 'resume-owned' && operation !== 'fork-owned') return;
    dialogPendingRef.current = true; setDialogPending(true); setPendingFor(target, true); setError('');
    let opened = false;
    try {
      const session = await (operation === 'resume-owned' ? window.prime.resumeOwnedSession(target, true) : window.prime.forkOwnedSession(target, true, forkEntryId || undefined));
      opened = true;
      setSessions(previous => [session, ...previous.filter(item => item.id !== session.id)]);
      if (dialogRef.current === operation) setDialog(null);
      if (activeIdRef.current === target) {
        if (operation === 'fork-owned') setActiveId(session.id);
        else await readMessages(target);
      }
      await refresh();
    } catch (error) { setError(`${opened ? 'Session opened, but the view could not refresh. Do not repeat the operation' : operation === 'resume-owned' ? 'Resume session' : 'Fork session'}: ${errorText(error)}`); }
    finally { setPendingFor(target, false); dialogPendingRef.current = false; setDialogPending(false); }
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
    <Sidebar sidebarRef={sidebarRef} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} dialog={dialog} narrow={narrow} drawerOpen={drawerOpen} newSession={newSession} search={search} setSearch={setSearch} sessions={sessions} grouped={grouped} loading={loading} activeId={activeId} setActiveId={setActiveId} setMenuOpen={setMenuOpen} meta={meta} updateMeta={updateMeta} metaStorageError={metaStorageError} knownTags={knownTags} tagFilter={tagFilter} setTagFilter={setTagFilter} connection={connection} connecting={connecting} reconnect={reconnect} setDialog={setDialog} />
    <main inert={!!dialog || drawerOpen} className="main-panel">
      <Topbar sidebarToggle={sidebarToggle} setSidebarOpen={setSidebarOpen} active={active} running={running} readOnly={readOnly} pending={pending} connection={connection} messages={messages} workspaceOpen={workspaceOpen} setWorkspaceOpen={setWorkspaceOpen} menuOpen={menuOpen} setMenuOpen={setMenuOpen} meta={meta} updateMeta={updateMeta} setTagInput={setTagInput} setRenameTitle={setRenameTitle} setDialog={setDialog} setError={setError} exportConversation={exportConversation} showHistoryAction={showHistoryAction} />
      {active && <div className="session-context"><button onClick={() => void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err)))} title={active.cwd}><Folder size={13} /><span>{active.cwd}</span></button><span className="context-separator" /><span><Zap size={12} />{active.model || 'CLI default'}</span></div>}
      {active?.ownership === 'desktop' && <div className="offline-banner">Desktop-owned · {active.lifecycle === 'open' ? 'Tools can change files. Quitting stops this session. Model changes may update CLI defaults.' : 'Closed — saved history is read-only.'}</div>}
      {active && <details className="queue-status"><summary>Work &amp; queue status</summary><p>{running ? 'Agent reports active work.' : 'Agent reports no active work.'} {pending ? 'A desktop request is awaiting confirmation.' : 'No desktop request is pending for this session.'}</p>{typeof active.queuedCount === 'number' ? <p>Agent reports {active.queuedCount === 0 ? 'no queued follow-ups' : `${active.queuedCount} queued follow-up${active.queuedCount === 1 ? '' : 's'}`}. Queued message text, ordering and cancellation are not available through this connection.</p> : <p>Authoritative queue details are unavailable with this daemon protocol. This is not an empty-queue report. View, edit, or cancel queued work in the CLI.</p>}{active.ownership === 'desktop' && active.writable && <SessionUsage key={active.id} sessionId={active.id} idle={!running && !pending && !active.queuedCount} onCompacted={() => void refresh()} onError={message => { if (activeIdRef.current === active.id) setError(message); }} />}</details>}
      {preferencesError && <div className="error-banner" role="alert">Workspace and model preferences could not be saved. They apply only to this window.</div>}
      {active?.ownership !== 'desktop' && connection?.readOnly && <div className="offline-banner" role="status">{connection?.canCreateOwned ? 'Shared CLI sessions are read-only. Start a new desktop-owned session to work with Prime.' : connection?.ownedReason || connection?.safetyReason}</div>}
      {error && <div className="error-banner" role="alert"><CircleHelp size={16} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {connection && !connection.connected && <div className="offline-banner"><span>{connection.error || 'Connect to Prime Agent to start working.'}</span><button onClick={reconnect} disabled={connecting}>{connecting ? 'Connecting...' : 'Start agent service / reconnect'}<RefreshCw size={12} className={connecting ? 'spin' : ''} /></button></div>}
      <div className={`content-scroll ${!activeId ? 'welcome-scroll' : ''}`} ref={scrollArea} onScroll={() => { const node = scrollArea.current; if (!node) return; if (node.scrollHeight - node.scrollTop - node.clientHeight < 100) setFollow(true); else if (node.scrollTop < lastScrollTop.current) setFollow(false); lastScrollTop.current = node.scrollTop; }}>
        {!activeId ? <Welcome onStarter={prompt => { setDraft(prompt); textarea.current?.focus(); }} /> : <Conversation conversationRef={conversationRef} knownIds={knownIds} active={active} running={running} loadingMessages={loadingMessages} messages={messages} conversationItems={conversationItems} visibleMessages={visibleMessages} setVisibleMessages={setVisibleMessages} setFollow={setFollow} />}
        {activeId && showJump && <div className="jump-latest-anchor"><button type="button" className="jump-latest" onClick={() => { setFollow(true); if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight; }}><ArrowDown size={13} />Jump to latest</button></div>}
      </div>
      <Composer textarea={textarea} active={active} activeId={activeId} running={running} pending={pending} readOnly={readOnly} readyToSend={readyToSend} requiresConsent={requiresConsent} allowFileChanges={allowFileChanges} setAllowFileChanges={setAllowFileChanges} draft={draft} setDraft={setDraft} draftImages={draftImages} draftEntry={draftEntry} canAttach={canAttach} reading={reading} attachmentReason={attachmentReason} addImages={addImages} removeImage={removeImage} cwd={cwd} currentCwd={currentCwd} chooseFolder={chooseFolder} model={model} models={models} modelSearch={modelSearch} setModelSearch={setModelSearch} changeModel={changeModel} notice={notice} setError={setError} submit={submit} stop={stop} />
      <footer className="main-footer"><span>MADE FOR YOUR NEXT BIG THING.</span><span>Build with intention.<DockMark /></span></footer>
    </main>
    {active && workspaceOpen && <div className="workspace-slot" inert={!!dialog}><WorkspacePanel sessionId={active.id} cwd={active.cwd} running={running} canEdit={active.ownership === 'desktop'} onClose={() => setWorkspaceOpen(false)} /></div>}
    {dialog && <Modal dialog={dialog} dialogPending={dialogPending} setDialog={setDialog}>{dialog === 'settings' ? <><AppearanceSettings appearance={appearance} onChange={changeAppearance} onClose={() => setDialog(null)} storageError={appearanceStorageError} /><DisplaySettings /><ProviderSettings onModelsChanged={setModels} /><ConnectionSettings onConnect={reconnect} /></> : dialog === 'palette' ? <CommandPalette commands={commands} onPick={command => { setDialog(null); command.run(); }} /> : dialog === 'tags' && active ? <TagsDialog active={active} meta={meta} updateMeta={updateMeta} tagInput={tagInput} setTagInput={setTagInput} onClose={() => setDialog(null)} /> : dialog === 'about' ? <AboutDialog connection={connection} onClose={() => setDialog(null)} /> : (dialog === 'resume-owned' || dialog === 'fork-owned') ? <HistoryDialog dialog={dialog} active={active} messages={messages} error={error} forkEntryId={forkEntryId} setForkEntryId={setForkEntryId} historyConsent={historyConsent} setHistoryConsent={setHistoryConsent} dialogPending={dialogPending} confirmHistory={confirmHistory} onClose={() => setDialog(null)} /> : dialog === 'close-owned' ? <CloseOwnedDialog dialogPending={dialogPending} confirmDialog={confirmDialog} onClose={() => setDialog(null)} /> : <RenameDeleteDialog dialog={dialog} active={active} renameTitle={renameTitle} setRenameTitle={setRenameTitle} dialogPending={dialogPending} confirmDialog={confirmDialog} onClose={() => setDialog(null)} />}</Modal>}
  </div>;
}
