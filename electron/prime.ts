import { historyThroughMessage } from './history-fork.js';
import { isVerifiedOwnedVersion, parseCliVersion, verifiedVersionsText } from './cli-versions.js';
import { execFile, spawn } from 'node:child_process';
import { access, stat, lstat, realpath, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { OwnedRpcSession, type OwnedRpcStats as SessionUsage } from './owned-rpc.js';
import { OwnedStore, type OwnedMetadata } from './owned-store.js';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DaemonTransport, type WireRecord } from './transport.js';
import { readBoundedFile, isRecord } from './bounded-io.js';
import { promptCommand, supportsImages, type ImageAttachment } from './attachments.js';
import { SavedTranscripts } from './saved-transcripts.js';
import { fallbackId, normalizeMessages, normalizeSession, parseSavedTranscript, snippetAround, text, type Message, type Session } from './transcript.js';

export { normalizeMessages, normalizeSession, parseSavedTranscript, snippetAround };

const exec = promisify(execFile);
interface CreateInput { prompt: string; cwd: string; model?: string; allowFileChanges?: boolean; images?: ImageAttachment[]; }
interface OwnedEntry { metadata: OwnedMetadata; rpc?: OwnedRpcSession; state?: WireRecord; error?: string; messages?: Message[]; streaming?: WireRecord; streamTimer?: ReturnType<typeof setTimeout>; }
/**
 * Pushed to the renderer for desktop-owned sessions. `stream` carries the in-progress assistant
 * reply (already normalized) so the UI can patch it in place; `changed` means the transcript gained
 * a whole message; `activity` means a run started or ended. Polling stays the source of truth.
 */
export type SessionEvent =
  | { type: 'stream'; sessionId: string; streamId: string; messages: Message[] }
  | { type: 'changed' | 'activity'; sessionId: string };
export interface PrimeOptions { socketPath?: string; home?: string; executable?: string; timeoutMs?: number; readOnly?: boolean; desktopDir?: string; onEvent?: (event: SessionEvent) => void;
  /** Moves a closed desktop transcript to the OS trash when it is deleted. Without it, deletion is refused. */
  trash?: (file: string) => Promise<void>; }
/** How often a streaming reply is pushed to the renderer at most. Token events can arrive far faster. */
const STREAM_INTERVAL_MS = 50;
/** Parsed saved transcripts kept for switching between recent sessions. */
const TRANSCRIPT_CACHE_ENTRIES = 6;
/** Text kept for full-text search across every saved transcript. */
const SEARCH_CACHE_BYTES = 32 * 1024 * 1024;
export interface SearchMatch { id: string; snippet: string }


export class PrimeService {
  private transport: DaemonTransport;
  private owned = new Map<string, OwnedEntry>();
  private openingHistory = new Set<string>();
  private store?: OwnedStore;
  private initialized?: Promise<void>;
  private ownedVersion?: Promise<{ allowed: boolean; reason?: string; checkedAt: number }>;
  private closing = false;
  private closingPromise?: Promise<void>;
  private creations = new Set<Promise<Session>>();
  private sessions = new Map<string, WireRecord>();
  private options: PrimeOptions;
  private home: string;
  private executable?: string;
  private transcripts = new SavedTranscripts(entries => entries > TRANSCRIPT_CACHE_ENTRIES);
  private searchTranscripts = new SavedTranscripts((_entries, bytes) => bytes > SEARCH_CACHE_BYTES);
  private modelsLoading?: Promise<{ id: string; name: string }[]>;
  constructor(options: PrimeOptions = {}) {
    this.options = options;
    if (options.desktopDir) this.store = new OwnedStore(options.desktopDir);
    this.home = options.home ?? homedir();
    const socket = options.socketPath ?? process.env.PRIME_DESKTOP_SOCKET ?? join(tmpdir(), `prime-agent-${process.getuid?.() ?? 'user'}`, 'daemon.sock');
    this.transport = new DaemonTransport(socket, options.timeoutMs);
  }
  private assertWritable(): never {
    throw new Error('Read-only compatibility mode: this daemon cannot atomically guard session identity. Use the Prime Agent CLI for session changes until a supported identity-safe protocol is available.');
  }
  private async initializeOwned() {
    if (!this.initialized) this.initialized = (async () => {
      if (this.store) for (const metadata of await this.store.list()) this.owned.set(metadata.id, { metadata });
    })();
    await this.initialized;
  }
  private async ownedSupport(recheck = false): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.store || this.options.readOnly) return { allowed: false, reason: 'Desktop-owned sessions are not enabled for this connection.' };
    // A verified CLI stays verified. A failed check is retried (immediately on an explicit
    // reconnect, otherwise at most every 30 seconds), so installing or upgrading needs no restart.
    const previous = this.ownedVersion;
    if (previous) {
      const result = await previous;
      if (!result.allowed && this.ownedVersion === previous && (recheck || Date.now() - result.checkedAt > 30_000)) this.ownedVersion = undefined;
    }
    if (!this.ownedVersion) this.ownedVersion = (async () => {
      try {
        const { stdout, stderr } = await exec(await this.cli(), ['--version'], { timeout: 5000, maxBuffer: 8192 });
        const version = parseCliVersion(`${stdout}\n${stderr}`);
        if (isVerifiedOwnedVersion(version)) return { allowed: true, checkedAt: Date.now() };
        const found = version ? `Prime Agent ${version} is installed. ` : '';
        return { allowed: false, reason: `${found}Desktop-owned sessions currently require verified Prime Agent ${verifiedVersionsText()}. Shared sessions remain read-only.`, checkedAt: Date.now() };
      } catch { return { allowed: false, reason: `Install Prime Agent ${verifiedVersionsText()} or check the CLI executable path in Settings.`, checkedAt: Date.now() }; }
    })();
    return this.ownedVersion;
  }
  private ownedSession(entry: { metadata: OwnedMetadata; rpc?: OwnedRpcSession; state?: WireRecord; error?: string }): Session {
    return { ...entry.metadata, model: entry.state?.model ? [entry.state.model.provider, entry.state.model.id].filter(Boolean).join('/') : entry.metadata.model,
      status: entry.error ? 'error' : entry.state?.isStreaming || entry.state?.isCompacting || entry.state?.unfinishedActionCount > 0 ? 'running' : 'idle',
      ...(Number.isSafeInteger(entry.state?.sessionActions?.queuedCount) && entry.state!.sessionActions.queuedCount >= 0 ? { queuedCount: entry.state!.sessionActions.queuedCount } : {}),
      ...(entry.state?.model ? { supportsImages: supportsImages(entry.state.model) } : {}),
      ownership: 'desktop', writable: !!entry.rpc?.alive && !this.closing, lifecycle: entry.rpc?.alive ? 'open' : 'closed', ...(entry.metadata.archived ? { archived: true } : {}) };
  }
  private async liveOwned(id: string) {
    await this.initializeOwned();
    if (this.closing) throw Error('Desktop sessions are closing.');
    const entry = this.owned.get(id);
    if (!entry) return this.assertWritable();
    if (!entry.rpc?.alive) throw Error('This desktop session is closed. Its saved history is read-only. Use Resume saved session or start a new session to continue.');
    return entry as typeof entry & { rpc: OwnedRpcSession };
  }
  async hasOpenOwnedSessions() { return this.creations.size > 0 || [...this.owned.values()].some(entry => entry.rpc?.alive); }
  private async cli(): Promise<string> {
    if (this.executable) return this.executable;
    const explicit = this.options.executable ?? process.env.PRIME_AGENT_BIN;
    if (explicit) return (this.executable = explicit);
    for (const candidate of [join(this.home, '.local/bin/prime-agent'), '/opt/homebrew/bin/prime-agent', '/usr/local/bin/prime-agent']) {
      try { await access(candidate, constants.X_OK); return (this.executable = candidate); } catch { /* next */ }
    }
    return 'prime-agent';
  }
  async status(recheck = false) {
    const support = await this.ownedSupport(recheck);
    try {
      const hello = await this.transport.connect();
      return { connected: true, version: text(hello.appVersion) || text(hello.version), home: this.home, readOnly: true, canCreateOwned: support.allowed,
        ownedReason: support.reason, safetyReason: 'Shared CLI sessions are read-only. New desktop-owned sessions use an isolated RPC connection; they can change files with your user permissions.' };
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error), home: this.home, readOnly: true, canCreateOwned: support.allowed, ownedReason: support.reason };
    }
  }
  async connect() {
    const current = await this.status(true);
    if (current.connected || this.options.readOnly || !/ENOENT|ECONNREFUSED/.test(current.error ?? '')) return current;
    // Explicit user reconnect may start the supervisor, never a session or an LLM request.
    const child = spawn(await this.cli(), ['--mode', 'daemon', '--daemon-socket', this.transport.socketPath], { detached: true, stdio: 'ignore', cwd: this.home });
    let launchError: Error | undefined;
    child.once('error', error => { launchError = error; });
    child.unref();
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (launchError) return { connected: false, error: `Could not start Prime Agent: ${launchError.message}. Install the CLI and run prime-agent once to log in.`, home: this.home };
      const result = await this.status();
      if (result.connected) return result;
    }
    return { connected: false, error: 'Could not connect. Run prime-agent in a terminal, then reconnect.', home: this.home };
  }
  async listSessions(): Promise<Session[]> {
    await this.initializeOwned();
    for (const entry of this.owned.values()) {
      if (entry.rpc && !entry.rpc.alive && !entry.error) entry.error = 'Owned process stopped. Saved history is read-only.';
    }
    let data: WireRecord;
    try { data = await this.transport.request({ type: 'list', all: true }); }
    catch (error) { if (this.owned.size || (await this.ownedSupport()).allowed) return [...this.owned.values()].map(entry => this.ownedSession(entry)); throw error; }
    if (!Array.isArray(data.sessions) || !data.sessions.every(isRecord)) throw new Error('Invalid daemon session list.');
    const next = new Map<string, WireRecord>();
    for (const raw of data.sessions) {
      if (raw.runtimeKind === 'subagent' || raw.rlmDepth > 0 || raw.parentSessionId) continue;
      const session = normalizeSession(raw);
      if (session.id && ![...this.owned.values()].some(entry => entry.metadata.sessionId === session.id)) next.set(session.id, raw);
    }
    this.sessions = next;
    return [...[...next.values()].map(raw => ({ ...normalizeSession(raw), ownership: 'shared' as const, writable: false })), ...[...this.owned.values()].map(entry => this.ownedSession(entry))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private async lookup(id: string, refresh = false): Promise<WireRecord> {
    // Mutations re-resolve persistent IDs: a CLI can replace the runtime behind
    // an active-session ID while the desktop catalog is stale.
    // Resolve only opaque IDs from the daemon catalog, never a renderer-supplied path.
    if (refresh || !this.sessions.has(id)) await this.listSessions();
    const raw = this.sessions.get(id);
    if (!raw) throw new Error('Session not found. Refresh the session list.');
    return raw;
  }
  async getMessages(id: string): Promise<Message[]> {
    await this.initializeOwned();
    const entry = this.owned.get(id);
    if (entry?.rpc?.alive) {
      try {
        const snapshot = await entry.rpc.refresh();
        entry.state = snapshot.state;
        const records = [...snapshot.messages];
        if (entry.streaming && !records.some(message => message.role === entry.streaming?.role && message.timestamp === entry.streaming?.timestamp)) records.push(entry.streaming);
        entry.messages = normalizeMessages(records);
        return entry.messages;
      } catch (error) { entry.error = error instanceof Error ? error.message : String(error); throw error; }
    }
    // Runtime IDs are reusable, so use the catalog's persisted file and verify its header.
    const raw = entry ? { sessionFile: entry.metadata.sessionFile } : await this.lookup(id, true);
    return this.transcripts.read(id, raw.sessionFile, entry?.metadata.sessionId ?? id);
  }
  /**
   * Sessions whose saved conversation text contains `query` (case-insensitive), with a short excerpt.
   * Reads only transcripts the catalog or desktop storage already names, with the same identity
   * checks and 64 MiB limit as opening them. Unreadable transcripts are skipped.
   */
  async searchSessions(query: string): Promise<SearchMatch[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const sessions = await this.listSessions();
    const matches: SearchMatch[] = [];
    for (const session of sessions) {
      const entry = this.owned.get(session.id);
      let messages: Message[];
      try {
        messages = entry?.rpc?.alive && entry.messages ? entry.messages
          : await this.searchTranscripts.read(session.id, entry ? entry.metadata.sessionFile : this.sessions.get(session.id)?.sessionFile, entry?.metadata.sessionId ?? session.id);
      } catch { continue; }
      for (const message of messages) {
        const index = message.content.toLowerCase().indexOf(needle);
        if (index !== -1) { matches.push({ id: session.id, snippet: snippetAround(message.content, index, needle.length) }); break; }
      }
      if (matches.length >= 100) break;
    }
    return matches;
  }
  async listModels(): Promise<{ id: string; name: string }[]> {
    if (!this.modelsLoading) this.modelsLoading = this.loadModels().finally(() => { this.modelsLoading = undefined; });
    return this.modelsLoading;
  }
  private async loadModels(): Promise<{ id: string; name: string }[]> {
    // model list has no JSON format in 0.9.5. Use its stable provider/model columns.
    // Unlike get_available_models this works even with no active sessions.
    const { stdout } = await exec(await this.cli(), ['model', 'list'], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } });
    const models: { id: string; name: string }[] = [];
    // Strip ANSI color codes before parsing columns.
    // eslint-disable-next-line no-control-regex
    for (const line of stdout.replace(/\u001b\[[0-9;]*m/g, '').split('\n')) {
      const match = line.trim().match(/^(\S+)\s+(\S+)\s+[\d.]+[KMB]?\s+/);
      if (match) models.push({ id: `${match[1]}/${match[2]}`, name: `${match[2]} · ${match[1]}` });
    }
    if (!models.length && stdout.trim() && !/no (?:available |configured )?models|provider\s+model/i.test(stdout)) throw new Error('Unrecognized CLI model catalog. Update the CLI or check model configuration.');
    return models;
  }
  async createSession(input: CreateInput): Promise<Session> {
    if (this.closing) throw Error('Desktop sessions are closing.');
    const task = (async () => {
      if (!(await this.ownedSupport()).allowed) return this.assertWritable();
      if (input.allowFileChanges !== true) throw Error('Confirm that the agent may run tools and change files before starting.');
      const command = promptCommand(input.prompt, input.images);
      input = { ...input, images: command.images };
      if (!isAbsolute(input.cwd) || !(await stat(input.cwd)).isDirectory()) throw Error('Choose an existing absolute workspace.');
      if (this.closing) throw Error('Desktop sessions are closing.');
      return this.createOwned(input);
    })();
    this.creations.add(task);
    try { return await task; } finally { this.creations.delete(task); }
  }
  private emit(event: SessionEvent) {
    try { this.options.onEvent?.(event); } catch { /* A renderer that went away must not break the RPC event loop. */ }
  }
  /** Push the streaming reply at most every STREAM_INTERVAL_MS; the latest text wins. */
  private scheduleStream(entry: OwnedEntry) {
    if (entry.streamTimer || !this.options.onEvent) return;
    entry.streamTimer = setTimeout(() => {
      entry.streamTimer = undefined;
      const streaming = entry.streaming;
      if (!streaming || !entry.rpc?.alive) return;
      const messages = normalizeMessages([streaming]);
      this.emit({ type: 'stream', sessionId: entry.metadata.id, streamId: text(streaming.id) || fallbackId(streaming, 0, new Map()), messages });
    }, STREAM_INTERVAL_MS);
  }
  private endStream(entry: OwnedEntry) {
    entry.streaming = undefined;
    clearTimeout(entry.streamTimer); entry.streamTimer = undefined;
  }
  private observeOwned(entry: OwnedEntry) {
    const metadata = entry.metadata;
    entry.rpc!.onEvent(event => {
      if (event.type === 'agent_start') { (entry.state ??= {}).isStreaming = true; this.emit({ type: 'activity', sessionId: metadata.id }); }
      if (event.type === 'agent_end') { (entry.state ??= {}).isStreaming = false; this.endStream(entry); this.emit({ type: 'activity', sessionId: metadata.id }); }
      if ((event.type === 'message_update' || event.type === 'message_start') && isRecord(event.message) && event.message.role === 'assistant') { entry.streaming = event.message; this.scheduleStream(entry); }
      if (event.type === 'message_end') { this.endStream(entry); this.emit({ type: 'changed', sessionId: metadata.id }); }
      metadata.updatedAt = new Date().toISOString();
      // Persist activity at the end of each run so history sorts correctly after a relaunch.
      if (event.type === 'agent_end') void this.persistActivity(metadata);
    });
  }
  resumeOwnedSession(id: string, allowFileChanges: boolean): Promise<Session> { return this.openHistory(id, 'resume', allowFileChanges); }
  forkOwnedSession(id: string, allowFileChanges: boolean, entryId?: string): Promise<Session> { return this.openHistory(id, 'fork', allowFileChanges, entryId); }
  private async openHistory(id: string, mode: 'resume' | 'fork', consent: boolean, entryId?: string): Promise<Session> {
    if (this.closing) throw Error('Desktop sessions are closing.');
    if (this.openingHistory.has(id)) throw Error('This saved session is already opening.');
    this.openingHistory.add(id);
    const task = (async () => {
      await this.initializeOwned();
      const source = this.owned.get(id);
      if (!source) return this.assertWritable();
      if (!(await this.ownedSupport()).allowed) throw Error(`Opening saved sessions requires verified Prime Agent ${verifiedVersionsText()}.`);
      if (consent !== true) throw Error('Confirm workspace trust before opening saved history.');
      if (source.rpc?.alive) throw Error('Close the desktop session before resuming or forking its saved history.');
      await source.rpc?.close();
      await this.store!.initialize();
      const file = source.metadata.sessionFile;
      if (!(await lstat(file)).isFile() || await realpath(file) !== resolve(file) || dirname(file) !== this.store!.transcripts) throw Error('Saved history must be a regular file inside desktop storage.');
      let contents = await readBoundedFile(file);
      let header: WireRecord;
      try { header = JSON.parse(contents.split('\n', 1)[0]); } catch { throw Error('Invalid saved session header.'); }
      if (header?.type !== 'session' || header.id !== source.metadata.sessionId) throw Error('Saved session identity mismatch.');
      const cwd = await realpath(source.metadata.cwd);
      if (!header.cwd || await realpath(header.cwd) !== cwd) throw Error('Saved session workspace mismatch.');
      if (!(await stat(cwd)).isDirectory()) throw Error('Saved workspace is unavailable.');
      // Parse before launch: malformed/ambiguous history must not be admitted to a new owner.
      parseSavedTranscript(contents);
      if (contents.split('\n').slice(1).some(line => { try { return JSON.parse(line)?.type === 'session'; } catch { return false; } })) throw Error('Multiple session headers. Refusing ambiguous saved history.');
      if (this.closing) throw Error('Desktop sessions are closing.');
      let launchFile = file;
      if (entryId !== undefined) {
        contents = historyThroughMessage(contents, entryId);
        launchFile = join(this.store!.transcripts, '.fork-source-' + randomUUID() + '.snapshot');
        await writeFile(launchFile, contents, {flag:'wx', mode:0o600});
      }
      let rpc: OwnedRpcSession;
      try { rpc = await OwnedRpcSession.launch({ executable: await this.cli(), cwd, sessionDir: this.store!.transcripts, socketPath: this.transport.socketPath, source: {mode, sessionFile:launchFile, sessionId:source.metadata.sessionId} }); }
      catch (error) { if (launchFile !== file) await unlink(launchFile).catch(() => {}); throw error; }
      try {
        const state = await rpc.getState();
        if (mode === 'fork') {
          // Verify what the CLI copied, not just a header checked before an asynchronous launch.
          const forkContents = await readBoundedFile(rpc.sessionFile);
          const forkHeader = JSON.parse(forkContents.split('\n', 1)[0]);
          if (forkHeader?.type !== 'session' || forkHeader.id !== rpc.id || forkHeader.parentSession !== launchFile ||
              JSON.stringify(normalizeMessages(parseSavedTranscript(forkContents))) !== JSON.stringify(normalizeMessages(parseSavedTranscript(contents)))) {
            throw Error('Fork history mismatch. The saved source changed or the CLI copied different history.');
          }
        }
        if (this.closing) throw Error('Desktop closed before saved history opened.');
        const now = new Date().toISOString();
        const metadata: OwnedMetadata = mode === 'resume'
          // A resumed session is live again, so it comes out of the archive.
          ? {...source.metadata, archived:undefined, model:[state.model?.provider,state.model?.id].filter(Boolean).join('/'), updatedAt:now}
          : {id:`desktop-${randomUUID()}`,sessionId:rpc.id,sessionFile:rpc.sessionFile,title:`Fork of ${source.metadata.title}`.slice(0,200),cwd,model:[state.model?.provider,state.model?.id].filter(Boolean).join('/'),createdAt:now,updatedAt:now};
        await this.store!.save(metadata);
        const entry: OwnedEntry = {metadata,rpc,state};
        this.owned.set(metadata.id,entry); this.observeOwned(entry);
        return this.ownedSession(entry);
      } catch (error) { await rpc.close(); if (launchFile !== file) await unlink(launchFile).catch(() => {}); throw error; }
    })();
    this.creations.add(task);
    try { return await task; }
    finally { this.creations.delete(task); this.openingHistory.delete(id); }
  }
  private async createOwned(input: CreateInput): Promise<Session> {
    await this.initializeOwned(); await this.store!.initialize();
    if (this.closing) throw Error('Desktop sessions are closing.');
    const rpc = await OwnedRpcSession.launch({ executable: await this.cli(), cwd: input.cwd, sessionDir: this.store!.transcripts, model: input.model, socketPath: this.transport.socketPath });
    const now = new Date().toISOString();
    const metadata: OwnedMetadata = { id: `desktop-${randomUUID()}`, sessionId: rpc.id, sessionFile: rpc.sessionFile, cwd: input.cwd, title: input.prompt.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Image conversation', model: input.model ?? '', createdAt: now, updatedAt: now };
    const entry = { metadata, rpc, state: {} as WireRecord, error: undefined as string | undefined, streaming: undefined as WireRecord | undefined };
    try {
      if (this.closing) throw Error('Desktop closed before the session started.');
      entry.state = await rpc.getState();
      if (input.images?.length && !supportsImages(entry.state.model)) throw Error('The selected model does not report image support. Choose an image-capable model before sending.');
      await this.store!.save(metadata); this.owned.set(metadata.id, entry);
      this.observeOwned(entry);
      if (this.closing) throw Error('Desktop closed before prompt admission.');
      entry.state.isStreaming = true; await rpc.send(input.prompt, input.images);
      return this.ownedSession(entry);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      // Never auto-retry an uncertain prompt. Retain the record and let the user inspect it.
      if (!this.owned.has(metadata.id) || this.closing) await rpc.close();
      throw Error(`Desktop session ${metadata.id} could not finish starting: ${entry.error}. Check its history before retrying.`);
    }
  }
  async sendMessage(id: string, message: string, images?: ImageAttachment[]): Promise<void> {
    const entry = await this.liveOwned(id); await entry.rpc.send(message, images); entry.metadata.updatedAt = new Date().toISOString();
    // Admission is success even if later state/transcript refresh fails. UI reads separately.
    await this.persistActivity(entry.metadata);
  }
  /** Best effort: a metadata write failure must never turn an accepted operation into an error. */
  private persistActivity(metadata: OwnedMetadata): Promise<void> {
    return this.store ? this.store.save(metadata).catch(() => {}) : Promise.resolve();
  }
  async interruptSession(id: string): Promise<void> { const entry = await this.liveOwned(id); await entry.rpc.abort(); }
  async setSessionModel(id: string, model: string): Promise<void> {
    const slash = model.indexOf('/'); if (slash < 1 || slash === model.length - 1) throw Error('Choose an available provider/model.');
    const entry = await this.liveOwned(id); await entry.rpc.setModel(model.slice(0, slash), model.slice(slash + 1));
    entry.state = (await entry.rpc.refresh()).state; entry.metadata.model = model; await this.store!.save(entry.metadata);
  }
  async getSessionUsage(id: string): Promise<SessionUsage> { const entry = await this.liveOwned(id); return entry.rpc.stats(); }
  async compactSession(id: string, instructions?: string): Promise<{ tokensBefore: number | null }> {
    const entry = await this.liveOwned(id);
    const result = await entry.rpc.compact(instructions);
    entry.state = (await entry.rpc.refresh()).state; entry.metadata.updatedAt = new Date().toISOString(); await this.persistActivity(entry.metadata);
    return result;
  }
  async renameSession(id: string, title: string): Promise<void> {
    await this.initializeOwned(); const entry = this.owned.get(id); if (!entry) return this.assertWritable();
    entry.metadata.title = title.trim().slice(0, 200); await this.store!.save(entry.metadata);
  }
  async closeOwnedSession(id: string): Promise<void> {
    await this.initializeOwned(); const entry = this.owned.get(id); if (!entry) return this.assertWritable();
    if (this.openingHistory.has(id)) throw Error('Wait until this saved session finishes opening.');
    this.endStream(entry); await entry.rpc?.close(); entry.rpc = undefined; entry.state = {}; await this.store!.save(entry.metadata);
  }
  /** Closed desktop history only: it lives in app storage, so the shared-daemon identity race does not apply. */
  private async closedOwned(id: string, action: string) {
    await this.initializeOwned();
    const entry = this.owned.get(id);
    if (!entry) return this.assertWritable();
    if (entry.rpc?.alive) throw Error(`Close the desktop session before you ${action} it.`);
    if (this.openingHistory.has(id)) throw Error('Wait until this saved session finishes opening.');
    return entry;
  }
  async setOwnedArchived(id: string, archived: boolean): Promise<void> {
    const entry = await this.closedOwned(id, archived ? 'archive' : 'unarchive');
    const metadata = { ...entry.metadata };
    if (archived) metadata.archived = true; else delete metadata.archived;
    await this.store!.save(metadata);
    entry.metadata = metadata;
  }
  /** Moves the saved transcript to the OS trash, then forgets the record. Workspace files are never touched. */
  async deleteSession(id: string): Promise<void> {
    const entry = await this.closedOwned(id, 'delete');
    if (!this.options.trash) throw Error('Deleting saved desktop history is not available here.');
    const file = entry.metadata.sessionFile;
    // Only ever trash a regular file inside desktop storage, never a path a record was edited to point at.
    const stats = await lstat(file).catch(error => { if (error?.code === 'ENOENT') return undefined; throw error; });
    if (stats) {
      if (!stats.isFile() || dirname(await realpath(file)) !== await realpath(this.store!.transcripts)) throw Error('Saved history must be a regular file inside desktop storage.');
      await this.options.trash(file);
    }
    await this.store!.remove(entry.metadata.id);
    this.owned.delete(id);
    this.transcripts.forget(id); this.searchTranscripts.forget(id);
  }
  close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise;
    this.closing = true; this.transport.close();
    this.closingPromise = (async () => {
      await Promise.allSettled([...this.creations]);
      await Promise.allSettled([...this.owned.values()].map(entry => entry.rpc?.close()));
    })();
    return this.closingPromise;
  }
}
