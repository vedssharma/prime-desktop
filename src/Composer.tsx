import type { FormEvent, RefObject } from 'react';
import { ArrowUp, ChevronDown, Folder, LoaderCircle, Square, Zap } from 'lucide-react';
import type { ModelOption, Session } from '../shared/types';
import type { DraftImage } from './attachments';
import { ImagePicker, DraftImages } from './ImageAttachments';
import { errorText, folderName } from './format';

type Props = {
  textarea: RefObject<HTMLTextAreaElement | null>;
  active: Session | undefined;
  activeId: string | null;
  running: boolean;
  pending: boolean;
  readOnly: boolean;
  readyToSend: boolean;
  requiresConsent: boolean;
  allowFileChanges: boolean;
  setAllowFileChanges: (allow: boolean) => void;
  draft: string;
  setDraft: (text: string) => void;
  draftImages: DraftImage[];
  draftEntry: { attachmentError?: string } | undefined;
  canAttach: boolean;
  reading: boolean;
  attachmentReason: string;
  addImages: (files: File[]) => Promise<void>;
  removeImage: (id: string) => void;
  cwd: string;
  currentCwd: string;
  chooseFolder: () => Promise<void>;
  model: string;
  models: ModelOption[];
  modelSearch: string;
  setModelSearch: (search: string) => void;
  changeModel: (value: string) => Promise<void>;
  notice: string | undefined;
  setError: (error: string) => void;
  submit: (event?: FormEvent) => Promise<void>;
  stop: () => Promise<void>;
};

export default function Composer({ textarea, active, activeId, running, pending, readOnly, readyToSend, requiresConsent, allowFileChanges, setAllowFileChanges, draft, setDraft, draftImages, draftEntry, canAttach, reading, attachmentReason, addImages, removeImage, cwd, currentCwd, chooseFolder, model, models, modelSearch, setModelSearch, changeModel, notice, setError, submit, stop }: Props) {
  return <div className={`composer-area ${!activeId ? 'welcome-composer' : ''}`}>{requiresConsent && <label className="workspace-consent"><input type="checkbox" checked={allowFileChanges} onChange={event => setAllowFileChanges(event.target.checked)} />I trust this workspace. Prime may run tools and change files with my user permissions. This is not a sandbox.</label>}<form className={`composer ${pending ? 'is-pending' : ''}`} onSubmit={submit}><DraftImages images={draftImages} onRemove={removeImage} />{draftEntry?.attachmentError && <p className="attachment-error" role="alert">{draftEntry.attachmentError}</p>}<label className="sr-only" htmlFor="prompt">Message Prime</label><textarea id="prompt" ref={textarea} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder={running ? 'Queue a follow-up for after this work...' : activeId ? 'What’s next? Ask Prime anything...' : 'What would you like to work on?'} rows={2} /><div className="composer-toolbar"><div className="composer-controls"><ImagePicker disabled={!canAttach || pending} busy={reading} reason={attachmentReason} onFiles={files => void addImages(files)} /><button type="button" className="folder-control" onClick={() => { if (active) void window.prime.openDirectory(active.cwd).catch(err => setError(errorText(err))); else void chooseFolder(); }} title={currentCwd || 'Choose project folder'}><Folder size={14} /><span>{folderName(currentCwd)}</span>{!active && <ChevronDown size={12} />}</button><span className="control-divider" />{!active && <input className="model-search" aria-label="Search models" placeholder="Find model…" value={modelSearch} onChange={event => setModelSearch(event.target.value)} />}<label className="model-control"><Zap size={13} /><span className="sr-only">Model</span><select aria-label="Model" value={active ? active.model || '' : model} disabled={!!active && (!active.writable || running || pending)} onChange={event => void changeModel(event.target.value)}><option value="">CLI default</option>{!active && model && !models.some(choice => choice.id === model) && <option value={model}>{model} (saved selection)</option>}{active?.model && !models.some(choice => choice.id === active.model) && <option value={active.model}>{active.model}</option>}{models.filter(choice => active || choice.id === model || `${choice.id} ${choice.name}`.toLowerCase().includes(modelSearch.toLowerCase())).map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>{!active && <ChevronDown size={11} />}</label></div><div className="send-controls">{pending && <span className="sending-label">Sending...</span>}{running && <button type="button" className="send-button stop-button" aria-label="Stop generation" title="Stop generation" onClick={stop} disabled={pending || readOnly || !readyToSend}><Square size={13} fill="currentColor" /></button>}<button className="send-button" type="submit" aria-label={running ? 'Queue follow-up' : 'Send message'} title={running ? 'Queue for after current work (Enter)' : 'Send message (Enter)'} disabled={readOnly || (!draft.trim() && !draftImages.length) || pending || reading || !readyToSend || (!active && !cwd) || (requiresConsent && !allowFileChanges)}>{pending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={19} />}</button></div></div></form><div className="composer-caption"><span role="status" title={notice}><span className="privacy-dot" />{notice || (running ? 'Follow-ups wait until current work finishes.' : 'Drafts stay in memory, not on disk.')}</span><span><kbd>↵</kbd> {running ? 'to queue' : 'to send'} <span className="caption-dot">·</span> <kbd>shift ↵</kbd> for a new line</span></div></div>;
}
