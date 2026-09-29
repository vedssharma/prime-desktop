import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File as FileIcon, Folder, GitBranch, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { WorkspaceChanges, WorkspaceFile, WorkspaceListing } from '../shared/types';
import { errorText } from './format';
import { languageForFile, tokenize } from './highlight';

type Tab = 'changes' | 'files';
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const lineClass = (line: string) => line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') ? 'meta' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';

export function DiffView({ diff }: { diff: string }) {
  return <pre className="diff-view" aria-label="Diff">{diff.split('\n').map((line, index) => <span key={index} className={`diff-line ${lineClass(line)}`}>{line || ' '}{'\n'}</span>)}</pre>;
}

function FileNode({ name, path, depth, sessionId, listings, expand, open, selected }: {
  name: string; path: string; depth: number; sessionId: string; listings: Record<string, WorkspaceListing | 'loading' | string>;
  expand: (path: string) => void; open: (path: string) => void; selected: string;
}) {
  const listing = listings[path];
  const isOpen = listing !== undefined;
  return <li>
    <button type="button" className="tree-row" style={{ paddingLeft: 8 + depth * 14 }} aria-expanded={isOpen} onClick={() => expand(path)}>
      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={13} /><span>{name}</span>
    </button>
    {listing === 'loading' && <p className="tree-note" style={{ paddingLeft: 30 + depth * 14 }}>Loading…</p>}
    {typeof listing === 'string' && listing !== 'loading' && <p className="tree-note" role="alert" style={{ paddingLeft: 30 + depth * 14 }}>{listing}</p>}
    {listing && typeof listing === 'object' && <ul>
      {listing.entries.map(entry => {
        const child = path ? `${path}/${entry.name}` : entry.name;
        if (entry.type === 'dir') return <FileNode key={child} name={entry.name} path={child} depth={depth + 1} sessionId={sessionId} listings={listings} expand={expand} open={open} selected={selected} />;
        return <li key={child}><button type="button" className={`tree-row ${selected === child ? 'selected' : ''}`} style={{ paddingLeft: 22 + (depth + 1) * 14 }} disabled={entry.type === 'link'} title={entry.type === 'link' ? 'Symbolic links are not followed' : undefined} onClick={() => open(child)}>
          <FileIcon size={13} /><span>{entry.name}</span>{entry.type === 'file' && <small>{sizeLabel(entry.size)}</small>}</button></li>;
      })}
      {listing.truncated && <li><p className="tree-note" style={{ paddingLeft: 30 + depth * 14 }}>Only the first entries are shown.</p></li>}
    </ul>}
  </li>;
}

export default function WorkspacePanel({ sessionId, cwd, running, onClose }: { sessionId: string; cwd: string; running: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('changes');
  const [changes, setChanges] = useState<WorkspaceChanges | null>(null);
  const [changesError, setChangesError] = useState('');
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [diff, setDiff] = useState<{ path: string; diff: string; truncated: boolean } | null>(null);
  const [diffError, setDiffError] = useState('');
  const [listings, setListings] = useState<Record<string, WorkspaceListing | 'loading' | string>>({});
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [fileError, setFileError] = useState('');
  const current = useRef(sessionId);
  current.current = sessionId;
  const changeRequest = useRef(0);

  const loadChanges = useCallback(async () => {
    const request = ++changeRequest.current, id = sessionId;
    setLoadingChanges(true); setChangesError('');
    try { const result = await window.prime.workspaceChanges(id); if (request === changeRequest.current && current.current === id) setChanges(result); }
    catch (error) { if (request === changeRequest.current && current.current === id) setChangesError(errorText(error)); }
    finally { if (request === changeRequest.current) setLoadingChanges(false); }
  }, [sessionId]);

  // Everything shown belongs to one session; switching sessions starts from a clean panel.
  useEffect(() => { setChanges(null); setDiff(null); setDiffError(''); setListings({}); setFile(null); setFileError(''); void loadChanges(); }, [sessionId, loadChanges]);
  // A run that just ended is the moment the changes are most likely to be new.
  const wasRunning = useRef(running);
  useEffect(() => { if (wasRunning.current && !running) void loadChanges(); wasRunning.current = running; }, [running, loadChanges]);

  async function showDiff(path: string) {
    const id = sessionId; setDiffError(''); setDiff(null);
    try { const result = await window.prime.workspaceDiff(id, path); if (current.current === id) setDiff(result); }
    catch (error) { if (current.current === id) setDiffError(errorText(error)); }
  }
  async function expand(path: string) {
    const id = sessionId;
    if (listings[path] !== undefined && listings[path] !== 'loading' && typeof listings[path] !== 'string') { setListings(previous => { const next = { ...previous }; delete next[path]; return next; }); return; }
    setListings(previous => ({ ...previous, [path]: 'loading' }));
    try { const result = await window.prime.workspaceList(id, path); if (current.current === id) setListings(previous => ({ ...previous, [path]: result })); }
    catch (error) { if (current.current === id) setListings(previous => ({ ...previous, [path]: errorText(error) })); }
  }
  useEffect(() => { if (tab === 'files' && listings[''] === undefined) void expand(''); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openFile(path: string) {
    const id = sessionId; setFileError(''); setFile(null);
    try { const result = await window.prime.workspaceRead(id, path); if (current.current === id) setFile(result); }
    catch (error) { if (current.current === id) setFileError(errorText(error)); }
  }

  const language = file && !file.binary ? languageForFile(file.path) : undefined;
  const root = listings[''];
  return <aside className="workspace-panel" aria-label="Workspace">
    <header><div role="tablist" aria-label="Workspace views">
      <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}><GitBranch size={13} />Changes{changes?.isRepo ? ` (${changes.changes.length}${changes.truncated ? '+' : ''})` : ''}</button>
      <button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}><Folder size={13} />Files</button>
    </div>
    <button className="icon-button" aria-label="Refresh workspace" onClick={() => { void loadChanges(); setListings({}); if (tab === 'files') void expand(''); }}>{loadingChanges ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}</button>
    <button className="icon-button" aria-label="Close workspace panel" onClick={onClose}><X size={16} /></button></header>
    <p className="workspace-note" title={cwd}>Read-only view of {cwd}. Agent tools are not confined to this folder.</p>
    {tab === 'changes' ? <div className="workspace-body">
      {changesError && <p role="alert" className="workspace-error">{changesError}</p>}
      {changes && !changes.isRepo && <p className="workspace-empty">{changes.error || 'This workspace is not a Git repository, so there is no change list.'}</p>}
      {changes?.isRepo && !changes.changes.length && <p className="workspace-empty">No uncommitted changes.</p>}
      {changes?.isRepo && changes.truncated && <p className="workspace-empty">Only the first {changes.changes.length} changes are listed.</p>}
      <ul className="change-list">{changes?.changes.map(change => <li key={change.path}><button type="button" className={diff?.path === change.path ? 'selected' : ''} onClick={() => void showDiff(change.path)}><em className={`change-${change.label.toLowerCase()}`}>{change.label}</em><span>{change.path}</span></button></li>)}</ul>
      {diffError && <p role="alert" className="workspace-error">{diffError}</p>}
      {diff && <div className="workspace-view">{diff.diff ? <DiffView diff={diff.diff} /> : <p className="workspace-empty">No textual diff for {diff.path}.</p>}{diff.truncated && <p className="workspace-empty">Diff truncated.</p>}</div>}
    </div> : <div className="workspace-body">
      {typeof root === 'string' && root !== 'loading' && <p role="alert" className="workspace-error">{root}</p>}
      {root === 'loading' && <p className="workspace-empty"><LoaderCircle size={13} className="spin" /> Loading…</p>}
      {root && typeof root === 'object' && <ul className="file-tree">
        {root.entries.map(entry => entry.type === 'dir'
          ? <FileNode key={entry.name} name={entry.name} path={entry.name} depth={0} sessionId={sessionId} listings={listings} expand={p => void expand(p)} open={p => void openFile(p)} selected={file?.path ?? ''} />
          : <li key={entry.name}><button type="button" className={`tree-row ${file?.path === entry.name ? 'selected' : ''}`} style={{ paddingLeft: 22 }} disabled={entry.type === 'link'} title={entry.type === 'link' ? 'Symbolic links are not followed' : undefined} onClick={() => void openFile(entry.name)}><FileIcon size={13} /><span>{entry.name}</span>{entry.type === 'file' && <small>{sizeLabel(entry.size)}</small>}</button></li>)}
        {root.truncated && <li><p className="tree-note">Only the first entries are shown.</p></li>}
      </ul>}
      {fileError && <p role="alert" className="workspace-error">{fileError}</p>}
      {file && <div className="workspace-view"><p className="workspace-file-name">{file.path} · {sizeLabel(file.size)}</p>
        {file.binary ? <p className="workspace-empty">Binary file — no preview.</p> : <pre className="file-view" aria-label="File contents"><code>{language ? tokenize(file.content, language).map((token, index) => token.kind === 'plain' ? token.text : <span key={index} className={`tok-${token.kind}`}>{token.text}</span>) : file.content}</code></pre>}
        {file.truncated && <p className="workspace-empty">Preview truncated to the first {sizeLabel(file.content.length)}.</p>}</div>}
    </div>}
  </aside>;
}
