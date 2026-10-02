import { memo, type RefObject } from 'react';
import { Archive, CircleHelp, LoaderCircle, MessageSquare, PanelLeftClose, Pin, Plus, RefreshCw, Search, Settings, Terminal, X } from 'lucide-react';
import type { ConnectionStatus, Session } from '../shared/types';
import type { SessionMeta } from './sessionMeta';
import type { DialogKind } from './Dialogs';
import DockMark from './DockMark';
import { folderName, relativeTime } from './format';
import { newSessionShortcut } from './platform';

type Props = {
  sidebarRef: RefObject<HTMLElement | null>;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  dialog: DialogKind | null;
  narrow: boolean;
  drawerOpen: boolean;
  newSession: () => void;
  search: string;
  setSearch: (search: string) => void;
  contentMatches: ReadonlyMap<string, string>;
  sessions: Session[];
  grouped: [string, Session[]][];
  loading: boolean;
  archivedCount: number;
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  activeId: string | null;
  setActiveId: (id: string) => void;
  setMenuOpen: (open: boolean) => void;
  meta: SessionMeta;
  updateMeta: (next: SessionMeta) => void;
  metaStorageError: boolean;
  knownTags: string[];
  tagFilter: string;
  setTagFilter: (tag: string) => void;
  connection: ConnectionStatus | null;
  connecting: boolean;
  reconnect: () => Promise<void>;
  setDialog: (dialog: DialogKind) => void;
};

export default memo(function Sidebar({ sidebarRef, sidebarOpen, setSidebarOpen, dialog, narrow, drawerOpen, newSession, search, setSearch, contentMatches, sessions, grouped, loading, archivedCount, showArchived, setShowArchived, activeId, setActiveId, setMenuOpen, meta, updateMeta, metaStorageError, knownTags, tagFilter, setTagFilter, connection, connecting, reconnect, setDialog }: Props) {
  return <>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}
    <aside ref={sidebarRef} inert={!!dialog || (narrow && !sidebarOpen)} aria-hidden={narrow && !sidebarOpen ? true : undefined} onKeyDown={event => { if (drawerOpen && event.key === 'Tab') { const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, [href]')).filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none'); const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }} className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="window-drag"><div className="window-dots" aria-hidden="true"><i /><i /><i /></div><span>SESSION DOCK</span></div>
      <div className="brand"><DockMark /><span className="brand-name">Session Dock</span><button className="icon-button mobile-close" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      <button className="new-session-button" onClick={newSession}><Plus size={17} /><span>New session</span><kbd>{newSessionShortcut}</kbd></button>
      <div className="sidebar-search"><Search size={15} /><input aria-label="Search sessions" placeholder="Search titles and conversations..." value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}</div>
      <div className="workspace-label"><span>YOUR WORKSPACE</span><span className="count">{sessions.length}</span></div>
      <div className="sidebar-controls"><label>Group by<select aria-label="Group sessions by" value={meta.groupBy} onChange={event => updateMeta({ ...meta, groupBy: event.target.value === 'workspace' ? 'workspace' : 'date' })}><option value="date">Date</option><option value="workspace">Workspace</option></select></label>{knownTags.length > 0 && <div className="tag-filter" role="group" aria-label="Filter by tag">{knownTags.map(tag => <button key={tag} type="button" aria-pressed={tagFilter.toLowerCase() === tag.toLowerCase()} onClick={() => setTagFilter(tagFilter.toLowerCase() === tag.toLowerCase() ? '' : tag)}>{tag}</button>)}</div>}{archivedCount > 0 && <label className="archived-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Show archived ({archivedCount})</label>}{metaStorageError && <p role="alert">Pins and tags could not be saved.</p>}</div>
      <nav className="session-list" aria-label="Sessions">
        {loading ? <div className="sidebar-empty"><LoaderCircle className="spin" size={16} /><span>Loading sessions...</span></div> : grouped.length ? grouped.map(([label, entries]) => <section className="session-group" key={label}><h2>{label}</h2>{entries.map(session => <button key={session.id} className={`session-item ${activeId === session.id ? 'selected' : ''}`} onClick={() => { setActiveId(session.id); setSidebarOpen(false); setMenuOpen(false); }} aria-current={activeId === session.id ? 'page' : undefined}>{meta.pinned.includes(session.id) ? <Pin size={15} aria-label="Pinned" /> : session.archived ? <Archive size={15} aria-label="Archived" /> : <MessageSquare size={15} />}<span className="session-item-text"><span>{session.title || 'Untitled session'}</span><small>{folderName(session.cwd)}{meta.tags[session.id]?.length ? ` · ${meta.tags[session.id].join(', ')}` : ''}</small>{search.trim() && contentMatches.has(session.id) && <small className="search-snippet" title={contentMatches.get(session.id)}>{contentMatches.get(session.id)}</small>}</span>{session.status === 'running' ? <span className="running-dot" title="Running" aria-label="Running" /> : <time>{relativeTime(session.updatedAt)}</time>}</button>)}</section>) : <div className="sidebar-empty"><MessageSquare size={19} /><p>{search ? 'No matching sessions' : 'A fresh start.'}<small>{search ? 'Try another search.' : 'Your sessions will appear here.'}</small></p></div>}
      </nav>
      <div className="sidebar-bottom"><div className="local-note"><Terminal size={15} /><div><strong>Unofficial companion for Prime Agent</strong><span>Independent community project</span></div></div><button className="connection-button" onClick={reconnect} disabled={connecting} title={connection?.error || 'Reconnect to Prime Agent'}><span className={`status-dot ${connection?.connected ? 'connected' : ''}`} /><span>{connecting ? 'Connecting...' : connection?.connected ? 'Agent connected' : connection ? 'Agent disconnected' : 'Checking connection...'}</span>{connecting ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}</button><div className="sidebar-footer"><span>COMMUNITY BUILT</span><button className="icon-button" aria-label="Settings" title="Settings" onClick={() => setDialog('settings')}><Settings size={16} /></button><button className="icon-button" aria-label="About Session Dock" onClick={() => setDialog('about')}><CircleHelp size={16} /></button></div></div>
    </aside>
  </>;
});
