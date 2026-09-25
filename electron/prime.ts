import { execFile, spawn } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { OwnedRpcSession } from './owned-rpc.js';
import { OwnedStore, type OwnedMetadata } from './owned-store.js';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { DaemonTransport, type WireRecord } from './transport.js';
import { readBoundedFile, isRecord } from './bounded-io.js';

const exec = promisify(execFile);
interface Session { id: string; title: string; cwd: string; model: string; status: 'idle' | 'running' | 'error'; updatedAt: string; createdAt: string; ownership?: 'shared' | 'desktop'; writable?: boolean; lifecycle?: 'open' | 'closed'; }
interface Message { id: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; timestamp?: string; toolName?: string; }
interface CreateInput { prompt: string; cwd: string; model?: string; allowFileChanges?: boolean; }
export interface PrimeOptions { socketPath?: string; home?: string; executable?: string; timeoutMs?: number; readOnly?: boolean; desktopDir?: string; }

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function date(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? undefined : result.toISOString();
}
export function normalizeSession(raw: WireRecord): Session {
  return {
    id: text(raw.sessionId) || text(raw.id),
    title: text(raw.sessionName) || text(raw.name) || text(raw.firstMessage) || 'Untitled session',
    cwd: text(raw.cwd), model: text(raw.model?.name) || text(raw.model?.id),
    status: raw.workerState === 'failed' || raw.rosterStatus === 'error' ? 'error' : raw.isStreaming || raw.isCompacting || raw.isBashRunning || raw.hasRunningRlmChildren || raw.activity === 'working' ? 'running' : 'idle',
    updatedAt: date(raw.lastActivityAt) || date(raw.modified) || date(raw.created) || new Date(0).toISOString(),
    createdAt: date(raw.created) || new Date(0).toISOString(),
  };
}

export function normalizeMessages(messages: WireRecord[]): Message[] {
  const output: Message[] = [];
  messages.forEach((message, index) => {
    const id = text(message.id) || `${message.role}-${message.timestamp ?? index}-${index}`;
    const timestamp = date(message.timestamp);
    if (message.role === 'custom' && message.display === false) return;
    const role: Message['role'] = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : ['toolResult', 'bashExecution'].includes(message.role) ? 'tool' : 'system';
    const blocks: WireRecord[] = Array.isArray(message.content) ? message.content : [];
    let content = typeof message.content === 'string' ? message.content : blocks.filter(block => block.type === 'text').map(block => text(block.text)).join('\n');
    if (['branchSummary', 'compactionSummary'].includes(message.role)) content = `${message.role === 'branchSummary' ? 'Branch summary' : 'Context summary'}\n\n${text(message.summary)}`;
    if (message.role === 'bashExecution') content = `$ ${text(message.command)}\n${text(message.output)}`;
    if (message.errorMessage) content += `${content ? '\n\n' : ''}Error: ${message.errorMessage}`;
    if (blocks.some(block => block.type === 'image')) content += '\n[Image attachment]';
    if (content.trim()) output.push({ id, role, content, timestamp, ...(message.toolName ? { toolName: text(message.toolName) } : {}) });
    blocks.filter(block => block.type === 'toolCall').forEach((block, i) => {
      output.push({ id: `${id}-call-${i}`, role: 'tool', toolName: text(block.name), timestamp, content: JSON.stringify(block.arguments ?? {}, null, 2) });
    });
  });
  return output;
}

/** Read the selected JSONL branch without opening/migrating/waking a saved worker. */
export function parseSavedTranscript(contents: string): WireRecord[] {
  const entries: WireRecord[] = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let entry: unknown;
    try { entry = JSON.parse(lines[i]); } catch { if (i !== lines.length - 1) throw new Error('Saved transcript contains invalid JSON.'); else continue; }
    if (!isRecord(entry) || typeof entry.type !== 'string') throw new Error('Saved transcript contains an invalid record.');
    entries.push(entry);
  }
  const nodes = entries.filter(entry => typeof entry.id === 'string' && entry.type !== 'session');
  const byId = new Map(nodes.map(entry => [entry.id, entry]));
  const branch: WireRecord[] = [];
  let cursor = nodes.at(-1);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  // Old v1 transcripts are linear and do not contain tree parent links.
  const tree = nodes.some(entry => 'parentId' in entry);
  // Display the selected history branch, not just the provider's compacted context.
  return (tree ? branch.reverse() : entries).flatMap(entry => {
    if (entry.type === 'message' && entry.message) return [{ ...entry.message, id: entry.id }];
    if (entry.type === 'custom_message') return [{ role: 'custom', content: entry.content, display: entry.display, timestamp: entry.timestamp, id: entry.id }];
    if (entry.type === 'branch_summary' || entry.type === 'compaction') return [{ role: entry.type === 'branch_summary' ? 'branchSummary' : 'compactionSummary', summary: entry.summary, timestamp: entry.timestamp, id: entry.id }];
    return [];
  });
}

export class PrimeService {
  private transport: DaemonTransport;
  private owned = new Map<string, { metadata: OwnedMetadata; rpc?: OwnedRpcSession; state?: WireRecord; error?: string; messages?: Message[]; streaming?: WireRecord }>();
  private store?: OwnedStore;
  private initialized?: Promise<void>;
  private ownedVersion?: Promise<{ allowed: boolean; reason?: string }>;
  private closing = false;
  private closingPromise?: Promise<void>;
  private creations = new Set<Promise<Session>>();
  private sessions = new Map<string, WireRecord>();
  private options: PrimeOptions;
  private home: string;
  private executable?: string;
  private transcriptCache?: { key: string; messages: Message[] };
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
  private async ownedSupport() {
    if (!this.store || this.options.readOnly) return { allowed: false, reason: 'Desktop-owned sessions are not enabled for this connection.' };
    if (!this.ownedVersion) this.ownedVersion = (async () => {
      try {
        const { stdout } = await exec(await this.cli(), ['--version'], { timeout: 5000, maxBuffer: 8192 });
        return /(?:^|\s)0\.9\.6(?:\s|$)/.test(stdout.trim()) ? { allowed: true } : { allowed: false, reason: 'Desktop-owned sessions currently require verified Prime Agent 0.9.6. Shared sessions remain read-only.' };
      } catch { return { allowed: false, reason: 'Install Prime Agent 0.9.6 or check the CLI executable path in Settings.' }; }
    })();
    return this.ownedVersion;
  }
  private ownedSession(entry: { metadata: OwnedMetadata; rpc?: OwnedRpcSession; state?: WireRecord; error?: string }): Session {
    return { ...entry.metadata, model: entry.state?.model ? [entry.state.model.provider, entry.state.model.id].filter(Boolean).join('/') : entry.metadata.model,
      status: entry.error ? 'error' : entry.state?.isStreaming || entry.state?.isCompacting || entry.state?.unfinishedActionCount > 0 ? 'running' : 'idle',
      ownership: 'desktop', writable: !!entry.rpc?.alive && !this.closing, lifecycle: entry.rpc?.alive ? 'open' : 'closed' };
  }
  private async liveOwned(id: string) {
    await this.initializeOwned();
    if (this.closing) throw Error('Desktop sessions are closing.');
    const entry = this.owned.get(id);
    if (!entry) return this.assertWritable();
    if (!entry.rpc?.alive) throw Error('This desktop session is closed. Its saved history is read-only. Start a new session to continue.');
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
  async status() {
    const support = await this.ownedSupport();
    try {
      const hello = await this.transport.connect();
      return { connected: true, version: text(hello.appVersion) || text(hello.version), home: this.home, readOnly: true, canCreateOwned: support.allowed,
        ownedReason: support.reason, safetyReason: 'Shared CLI sessions are read-only. New desktop-owned sessions use an isolated RPC connection; they can change files with your user permissions.' };
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error), home: this.home, readOnly: true, canCreateOwned: support.allowed, ownedReason: support.reason };
    }
  }
  async connect() {
    const current = await this.status();
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
    const expectedId = entry?.metadata.sessionId ?? id;
    if (!raw.sessionFile) throw new Error('This session has no saved transcript. Open it in the CLI.');
    const metadata = await stat(raw.sessionFile);
    const cacheKey = JSON.stringify([id, raw.sessionFile, metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs]);
    if (this.transcriptCache?.key === cacheKey) return this.transcriptCache.messages;
    if (metadata.size > 64 * 1024 * 1024) throw new Error('This saved transcript exceeds the 64 MiB desktop limit. Open it in the CLI.');
    const contents = await readBoundedFile(raw.sessionFile);
    let header: WireRecord;
    try { header = JSON.parse(contents.split('\n', 1)[0]); }
    catch { throw new Error('Invalid saved session header.'); }
    if (header?.type !== 'session' || header.id !== expectedId) throw new Error('Session identity mismatch. Refusing to display another conversation.');
    if (contents.split('\n').slice(1).some(line => { try { return JSON.parse(line)?.type === 'session'; } catch { return false; } })) throw new Error('Multiple session headers. Refusing an ambiguous transcript.');
    const messages = normalizeMessages(parseSavedTranscript(contents));
    this.transcriptCache = { key: cacheKey, messages };
    return messages;
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
    for (const line of stdout.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
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
      if (!input.prompt.trim() || input.prompt.trimStart().startsWith('/')) throw Error('Enter a plain-language prompt. Slash commands are not available for desktop-owned sessions.');
      if (!isAbsolute(input.cwd) || !(await stat(input.cwd)).isDirectory()) throw Error('Choose an existing absolute workspace.');
      if (this.closing) throw Error('Desktop sessions are closing.');
      return this.createOwned(input);
    })();
    this.creations.add(task);
    try { return await task; } finally { this.creations.delete(task); }
  }
  private async createOwned(input: CreateInput): Promise<Session> {
    await this.initializeOwned(); await this.store!.initialize();
    if (this.closing) throw Error('Desktop sessions are closing.');
    const rpc = await OwnedRpcSession.launch({ executable: await this.cli(), cwd: input.cwd, sessionDir: this.store!.transcripts, model: input.model, socketPath: this.transport.socketPath });
    const now = new Date().toISOString();
    const metadata: OwnedMetadata = { id: `desktop-${randomUUID()}`, sessionId: rpc.id, sessionFile: rpc.sessionFile, cwd: input.cwd, title: input.prompt.trim().slice(0, 100), model: input.model ?? '', createdAt: now, updatedAt: now };
    const entry = { metadata, rpc, state: {} as WireRecord, error: undefined as string | undefined, streaming: undefined as WireRecord | undefined };
    try {
      if (this.closing) throw Error('Desktop closed before the session started.');
      await this.store!.save(metadata); this.owned.set(metadata.id, entry);
      rpc.onEvent(event => {
        if (event.type === 'agent_start') entry.state.isStreaming = true;
        if (event.type === 'agent_end') { entry.state.isStreaming = false; entry.streaming = undefined; }
        if ((event.type === 'message_update' || event.type === 'message_start') && isRecord(event.message) && event.message.role === 'assistant') entry.streaming = event.message;
        if (event.type === 'message_end') entry.streaming = undefined;
        metadata.updatedAt = new Date().toISOString();
      });
      if (this.closing) throw Error('Desktop closed before prompt admission.');
      entry.state.isStreaming = true; await rpc.send(input.prompt);
      return this.ownedSession(entry);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      // Never auto-retry an uncertain prompt. Retain the record and let the user inspect it.
      if (!this.owned.has(metadata.id) || this.closing) await rpc.close();
      throw Error(`Desktop session ${metadata.id} could not finish starting: ${entry.error}. Check its history before retrying.`);
    }
  }
  async sendMessage(id: string, message: string): Promise<void> {
    const entry = await this.liveOwned(id); await entry.rpc.send(message); entry.metadata.updatedAt = new Date().toISOString();
    // Admission is success even if later state/transcript refresh fails. UI reads separately.
  }
  async interruptSession(id: string): Promise<void> { const entry = await this.liveOwned(id); await entry.rpc.abort(); }
  async setSessionModel(id: string, model: string): Promise<void> {
    const slash = model.indexOf('/'); if (slash < 1 || slash === model.length - 1) throw Error('Choose an available provider/model.');
    const entry = await this.liveOwned(id); await entry.rpc.setModel(model.slice(0, slash), model.slice(slash + 1));
    entry.state = (await entry.rpc.refresh()).state; entry.metadata.model = model; await this.store!.save(entry.metadata);
  }
  async renameSession(id: string, title: string): Promise<void> {
    await this.initializeOwned(); const entry = this.owned.get(id); if (!entry) return this.assertWritable();
    entry.metadata.title = title.trim().slice(0, 200); await this.store!.save(entry.metadata);
  }
  async closeOwnedSession(id: string): Promise<void> {
    await this.initializeOwned(); const entry = this.owned.get(id); if (!entry) return this.assertWritable();
    await entry.rpc?.close(); entry.rpc = undefined; entry.state = {}; await this.store!.save(entry.metadata);
  }
  async deleteSession(_id: string): Promise<void> { return this.assertWritable(); }
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
