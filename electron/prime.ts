import { execFile, spawn } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { DaemonTransport, type WireRecord } from './transport.js';

const exec = promisify(execFile);
interface Session { id: string; title: string; cwd: string; model: string; status: 'idle' | 'running' | 'error'; updatedAt: string; createdAt: string; }
interface Message { id: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; timestamp?: string; toolName?: string; }
interface CreateInput { prompt: string; cwd: string; model?: string; }
export interface PrimeOptions { socketPath?: string; home?: string; executable?: string; timeoutMs?: number; readOnly?: boolean; }

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
    try { entries.push(JSON.parse(lines[i])); }
    catch { if (i !== lines.length - 1) throw new Error('Saved transcript contains invalid JSON.'); }
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
  return (tree ? branch.reverse() : entries).filter(entry => entry.type === 'message' && entry.message).map(entry => ({ ...entry.message, id: entry.id }));
}

export class PrimeService {
  private transport: DaemonTransport;
  private sessions = new Map<string, WireRecord>();
  private options: PrimeOptions;
  private home: string;
  private executable?: string;
  private models?: { id: string; name: string }[];
  private modelsLoading?: Promise<{ id: string; name: string }[]>;
  constructor(options: PrimeOptions = {}) {
    this.options = options;
    this.home = options.home ?? homedir();
    const socket = options.socketPath ?? process.env.PRIME_DESKTOP_SOCKET ?? join(tmpdir(), `prime-agent-${process.getuid?.() ?? 'user'}`, 'daemon.sock');
    this.transport = new DaemonTransport(socket, options.timeoutMs);
  }
  private assertWritable() { if (this.options.readOnly) throw new Error('Prime Desktop is in read-only mode.'); }
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
    try {
      const hello = await this.transport.connect();
      return { connected: true, version: text(hello.appVersion) || text(hello.version), home: this.home };
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error), home: this.home };
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
    const data = await this.transport.request({ type: 'list', all: true });
    if (!Array.isArray(data.sessions)) throw new Error('Invalid daemon session list.');
    const next = new Map<string, WireRecord>();
    for (const raw of data.sessions) {
      if (raw.runtimeKind === 'subagent' || raw.rlmDepth > 0 || raw.parentSessionId) continue;
      const session = normalizeSession(raw);
      if (session.id) next.set(session.id, raw);
    }
    this.sessions = next;
    return [...next.values()].map(normalizeSession).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    const raw = await this.lookup(id);
    if (raw.activeSessionId) {
      const data = await this.transport.request({ type: 'get_messages', activeSessionId: raw.activeSessionId });
      if (!Array.isArray(data.messages)) throw new Error('Invalid daemon transcript.');
      const state = await this.transport.request({ type: 'get_state', activeSessionId: raw.activeSessionId });
      const messages = [...data.messages];
      if (state.streamingMessage) messages.push(state.streamingMessage);
      return normalizeMessages(messages);
    }
    if (!raw.sessionFile) return [];
    if ((await stat(raw.sessionFile)).size > 64 * 1024 * 1024) throw new Error('This saved transcript exceeds the 64 MiB desktop limit. Open it in the CLI.');
    return normalizeMessages(parseSavedTranscript(await readFile(raw.sessionFile, 'utf8')));
  }
  async listModels(): Promise<{ id: string; name: string }[]> {
    if (this.models) return this.models;
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
    this.models = models;
    return models;
  }
  async createSession(input: CreateInput): Promise<Session> {
    this.assertWritable();
    if (!input.prompt?.trim()) throw new Error('Enter a message.');
    if (!isAbsolute(input.cwd) || !(await stat(input.cwd)).isDirectory()) throw new Error('Choose an existing working directory.');
    const config: WireRecord = { cwd: input.cwd, agentDir: join(this.home, '.prime/agent') };
    if (input.model) {
      // Catalog IDs are provider/model. Explicitly override the provider too,
      // because the daemon merges create config with its launch defaults.
      const slash = input.model.indexOf('/');
      if (slash > 0) {
        config.provider = input.model.slice(0, slash);
        config.model = input.model.slice(slash + 1);
      } else config.model = input.model;
    }
    const raw = await this.transport.request({ type: 'create', lifecycle: 'resident', continueRecent: false, config }, 120_000);
    const session = normalizeSession(raw);
    if (!session.id || !raw.activeSessionId) throw new Error('Daemon returned an invalid new session.');
    this.sessions.set(session.id, raw);
    try { await this.transport.request({ type: 'prompt', activeSessionId: raw.activeSessionId, message: input.prompt, streamingBehavior: 'followUp' }); }
    catch (error) { throw new Error(`Session created, but sending failed: ${error instanceof Error ? error.message : error}. Refresh and open the new session before retrying.`); }
    return { ...session, status: 'running' };
  }
  private async activate(id: string): Promise<WireRecord> {
    const raw = await this.lookup(id, true);
    if (raw.activeSessionId) return raw;
    const resumed = await this.transport.request({ type: 'create', lifecycle: 'resident', sessionPath: raw.sessionFile, continueRecent: false }, 120_000);
    if (!resumed.activeSessionId) throw new Error('Could not resume session.');
    this.sessions.set(id, resumed);
    return resumed;
  }
  async sendMessage(id: string, message: string): Promise<void> {
    this.assertWritable();
    if (!message.trim()) throw new Error('Enter a message.');
    const raw = await this.activate(id);
    await this.transport.request({ type: 'prompt', activeSessionId: raw.activeSessionId, message, streamingBehavior: 'followUp' });
  }
  async interruptSession(id: string): Promise<void> {
    this.assertWritable();
    const raw = await this.lookup(id, true);
    if (raw.activeSessionId) await this.transport.request({ type: 'abort', activeSessionId: raw.activeSessionId });
  }
  async renameSession(id: string, title: string): Promise<void> {
    this.assertWritable();
    if (!title.trim()) throw new Error('Session title cannot be empty.');
    const raw = await this.lookup(id, true);
    await this.transport.request(raw.activeSessionId ? { type: 'rename', activeSessionId: raw.activeSessionId, name: title.trim() } : { type: 'rename_saved_session', sessionPath: raw.sessionFile, name: title.trim() });
    raw.sessionName = title.trim();
  }
  async deleteSession(id: string): Promise<void> {
    this.assertWritable();
    const raw = await this.lookup(id, true);
    if (raw.activeSessionId) await this.transport.request({ type: 'kill', activeSessionId: raw.activeSessionId });
    if (raw.sessionFile) {
      const result = await this.transport.request({ type: 'delete_saved_session', sessionPath: raw.sessionFile });
      if (result.ok === false) throw new Error(result.error ?? 'Could not delete saved session.');
    }
    this.sessions.delete(id);
  }
  close(): void { this.transport.close(); }
}
