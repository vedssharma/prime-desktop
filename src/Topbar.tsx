import type { RefObject } from 'react';
import { ArrowRight, CircleHelp, Copy, Download, FolderOpen, GitBranch, Menu, MoreHorizontal, PanelRight, Pencil, Pin, PinOff, Square, Tag, Trash2 } from 'lucide-react';
import type { ConnectionStatus, Message, Session } from '../shared/types';
import { togglePin, type SessionMeta } from './sessionMeta';
import type { ExportFormat } from './export';
import type { DialogKind } from './Dialogs';
import { errorText } from './format';
import { isElectron } from './platform';

type Props = {
  sidebarToggle: RefObject<HTMLButtonElement | null>;
  setSidebarOpen: (open: boolean) => void;
  active: Session | undefined;
  running: boolean;
  readOnly: boolean;
  pending: boolean;
  connection: ConnectionStatus | null;
  messages: Message[];
  workspaceOpen: boolean;
  setWorkspaceOpen: (open: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  meta: SessionMeta;
  updateMeta: (next: SessionMeta) => void;
  setTagInput: (value: string) => void;
  setRenameTitle: (value: string) => void;
  setDialog: (dialog: DialogKind) => void;
  setError: (error: string) => void;
  exportConversation: (format: ExportFormat | 'copy') => Promise<void>;
  showHistoryAction: (operation: 'resume-owned' | 'fork-owned') => void;
};

export default function Topbar({ sidebarToggle, setSidebarOpen, active, running, readOnly, pending, connection, messages, workspaceOpen, setWorkspaceOpen, menuOpen, setMenuOpen, meta, updateMeta, setTagInput, setRenameTitle, setDialog, setError, exportConversation, showHistoryAction }: Props) {
  return <header className="topbar"><div className="breadcrumb"><button ref={sidebarToggle} className="icon-button sidebar-toggle" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button><span className="breadcrumb-root">Workspace</span><span className="breadcrumb-slash">/</span><strong>{active?.title || 'New session'}</strong>{running && <span className="header-running"><span className="running-dot" />Working{active?.queuedCount ? ` · ${active.queuedCount} queued` : ''}</span>}</div><div className="topbar-actions">{!isElectron && <span className="preview-badge">READ-ONLY PREVIEW</span>}<span className="local-badge"><span /> LOCAL</span>{active && <button className="icon-button" aria-label="Workspace files and changes" aria-pressed={workspaceOpen} title="Workspace files and changes" onClick={() => setWorkspaceOpen(!workspaceOpen)}><PanelRight size={19} /></button>}{active && <div className="session-menu"><button className="icon-button" aria-label="Session actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={20} /></button>{menuOpen && <><button className="menu-dismiss" aria-label="Close session actions" onClick={() => setMenuOpen(false)} /><div className="dropdown"><button onClick={() => { updateMeta(togglePin(meta, active.id)); setMenuOpen(false); }}>{meta.pinned.includes(active.id) ? <PinOff size={14} /> : <Pin size={14} />}{meta.pinned.includes(active.id) ? 'Unpin session' : 'Pin session'}</button><button onClick={() => { setTagInput((meta.tags[active.id] ?? []).join(', ')); setDialog('tags'); setMenuOpen(false); }}><Tag size={14} />Edit tags</button><button disabled={readOnly} onClick={() => { setRenameTitle(active.title); setDialog('rename'); setMenuOpen(false); }}><Pencil size={14} />Rename session</button><button disabled={!messages.length} onClick={() => void exportConversation('markdown')}><Download size={14} />Export as Markdown</button><button disabled={!messages.length} onClick={() => void exportConversation('json')}><Download size={14} />Export as JSON</button><button disabled={!messages.length} onClick={() => void exportConversation('copy')}><Copy size={14} />Copy as Markdown</button><button onClick={() => { setMenuOpen(false); void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err))); }}><FolderOpen size={14} />Reveal folder</button>{active.ownership === 'desktop' && active.lifecycle === 'closed' && connection?.canCreateOwned && <><button disabled={pending} onClick={() => showHistoryAction('resume-owned')}><ArrowRight size={14} />Resume saved session</button><button disabled={pending} onClick={() => showHistoryAction('fork-owned')}><GitBranch size={14} />Fork saved session</button></>}{active.ownership === 'desktop' && active.lifecycle === 'open' && <button onClick={() => { setMenuOpen(false); setDialog('close-owned'); }}><Square size={14} />Close desktop session</button>}<button className="danger-text" disabled={readOnly || active.ownership === 'desktop'} onClick={() => { setDialog('delete'); setMenuOpen(false); }}><Trash2 size={14} />Delete session</button></div></>}</div>}<button className="icon-button help-button" aria-label="About this app" onClick={() => setDialog('about')}><CircleHelp size={18} /></button></div></header>;
}
