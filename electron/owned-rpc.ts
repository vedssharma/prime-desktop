import { mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isRecord } from './bounded-io.js';
import { RpcClient, type RpcLaunch } from './rpc-client.js';
import { promptCommand, supportsImages, type ImageAttachment } from './attachments.js';

type RecordValue = Record<string, any>;
export interface OwnedRpcLaunch {
  executable: string;
  cwd: string;
  sessionDir: string;
  model?: string;
  socketPath?: string;
  timeoutMs?: number;
  /** Explicit startup selection only; the bound pipe can never navigate afterward. */
  source?: { mode: 'resume' | 'fork'; sessionFile: string; sessionId: string };
}
export interface OwnedRpcState extends RecordValue {
  sessionId: string;
  sessionFile: string;
  isStreaming: boolean;
  isCompacting: boolean;
}
export interface OwnedRpcTransport {
  readonly alive: boolean;
  request(command: RecordValue, mutation?: boolean, timeoutMs?: number): Promise<any>;
  onEvent(listener: (event: RecordValue) => void): () => void;
  close(): Promise<void>;
}
export interface OwnedRpcStats {
  userMessages: number; assistantMessages: number; toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  context?: { tokens: number | null; contextWindow: number | null; percent: number | null };
}
export type OwnedRpcFactory = (launch: RpcLaunch) => OwnedRpcTransport;

/**
 * A new root owned by one RPC stdin pipe, not a writable daemon selector.
 * Ownership (verified Prime Agent versions, see cli-versions.ts) is the safety boundary. State checks alone are
 * not atomic identity guards. Never add runtime navigation or promotion here.
 * Explicit startup resume/fork is allowed only for verified closed desktop history.
 */
export class OwnedRpcSession {
  readonly id: string;
  readonly sessionFile: string;
  private frozen?: string;
  private closing?: Promise<void>;
  private listeners = new Set<(event: RecordValue) => void>();
  private unsubscribe: () => void;

  private constructor(private rpc: OwnedRpcTransport, readonly cwd: string, state: OwnedRpcState) {
    this.id = state.sessionId;
    this.sessionFile = state.sessionFile;
    this.unsubscribe = rpc.onEvent(event => {
      // No extensions are loaded. Never grant an unexpected extension dialog.
      // Close instead of introducing a generic extension response command API.
      if (event.type === 'extension_ui_request') {
        this.freeze('Unexpected extension UI request. The owned session is closed.');
        return;
      }
      if (!this.alive) return;
      for (const listener of this.listeners) listener(event);
    });
  }

  static async launch(options: OwnedRpcLaunch, factory: OwnedRpcFactory = launch => new RpcClient(launch)): Promise<OwnedRpcSession> {
    if (!options.executable.trim()) throw Error('A Prime Agent executable is required.');
    if (!isAbsolute(options.cwd) || !isAbsolute(options.sessionDir)) throw Error('Owned session directories must be absolute paths.');
    const cwd = await realpath(options.cwd);
    if (!(await stat(cwd)).isDirectory()) throw Error('Working directory must be a directory.');
    await mkdir(options.sessionDir, { recursive: true, mode: 0o700 });
    const sessionDir = await realpath(options.sessionDir);
    if (!(await stat(sessionDir)).isDirectory()) throw Error('Session storage must be a directory.');
    const args = ['--mode', 'rpc', '--cwd', cwd, '--session-dir', sessionDir, '--no-extensions'];
    if (options.source) {
      if (!['resume', 'fork'].includes(options.source.mode) || !options.source.sessionId || !isAbsolute(options.source.sessionFile)) throw Error('Invalid saved session source.');
      const sourceFile = await realpath(options.source.sessionFile);
      if (dirname(sourceFile) !== sessionDir || !(await stat(sourceFile)).isFile()) throw Error('Saved session source must be inside desktop storage.');
      args.push(`--${options.source.mode}`, sourceFile);
    }
    if (options.socketPath) args.push('--daemon-socket', resolve(options.socketPath));
    if (options.model) {
      if (!options.model.trim() || /[\r\n\0]/.test(options.model)) throw Error('Invalid model selector.');
      args.push('--model', options.model);
    }
    // No positional prompt: bind the new persistent identity before admission.
    const rpc = factory({ executable: options.executable, cwd, args, timeoutMs: options.timeoutMs });
    try {
      const state = OwnedRpcSession.parseState(await rpc.request({ type: 'get_state' }, false));
      if (dirname(resolve(state.sessionFile)) !== sessionDir) throw Error('Owned session storage mismatch.');
      if (options.source?.mode === 'resume' && (state.sessionId !== options.source.sessionId || state.sessionFile !== await realpath(options.source.sessionFile))) throw Error('Resumed session identity mismatch.');
      if (options.source?.mode === 'fork' && (state.sessionId === options.source.sessionId || resolve(state.sessionFile) === await realpath(options.source.sessionFile))) throw Error('Fork must have a separate session identity and transcript.');
      return new OwnedRpcSession(rpc, cwd, state);
    } catch (error) {
      await rpc.close();
      throw error;
    }
  }

  get alive(): boolean { return !this.frozen && !this.closing && this.rpc.alive; }

  onEvent(listener: (event: RecordValue) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private static parseState(value: unknown): OwnedRpcState {
    if (!isRecord(value) || typeof value.sessionId !== 'string' || !value.sessionId ||
        typeof value.sessionFile !== 'string' || !isAbsolute(value.sessionFile) ||
        typeof value.isStreaming !== 'boolean' || typeof value.isCompacting !== 'boolean') {
      throw Error('Invalid owned RPC session state.');
    }
    return value as OwnedRpcState;
  }

  private assertAlive(): void {
    if (!this.alive) throw Error(this.frozen ?? 'This desktop-owned session is closed. It was not automatically resumed.');
  }

  private freeze(reason: string): void {
    this.frozen ??= reason;
    void this.close();
  }

  async getState(): Promise<OwnedRpcState> {
    this.assertAlive();
    let state: OwnedRpcState;
    try { state = OwnedRpcSession.parseState(await this.rpc.request({ type: 'get_state' }, false)); }
    catch (error) {
      this.freeze('Could not verify the owned session identity. The session is closed.');
      throw error;
    }
    if (state.sessionId !== this.id || state.sessionFile !== this.sessionFile) {
      const reason = 'Owned session identity changed. Refusing to read or write another conversation.';
      this.freeze(reason);
      throw Error(reason);
    }
    this.assertAlive();
    return state;
  }

  async refresh(): Promise<{ state: OwnedRpcState; messages: RecordValue[] }> {
    await this.getState();
    const result: unknown = await this.rpc.request({ type: 'get_messages' }, false);
    const state = await this.getState();
    if (!isRecord(result) || !Array.isArray(result.messages) || !result.messages.every(isRecord)) {
      this.freeze('Invalid owned session transcript. The session is closed.');
      throw Error('Invalid owned session transcript.');
    }
    return { state, messages: result.messages };
  }

  private async mutate(command: RecordValue, timeoutMs?: number): Promise<any> {
    this.assertAlive();
    try { return await this.rpc.request(command, true, timeoutMs); }
    catch (error) {
      // A missing admission response is not a rejection. Do not offer retry on
      // this pipe after an uncertain result, or automatically recreate it.
      if (!this.rpc.alive || (error instanceof Error && /uncertain/i.test(error.message))) {
        this.freeze('The last operation has an uncertain outcome. The session is closed; do not resend automatically.');
      }
      throw error;
    }
  }

  async send(message: string, images?: ImageAttachment[]): Promise<void> {
    const command = promptCommand(message, images);
    const state = await this.getState();
    if (command.images?.length && !supportsImages(state.model)) throw Error('The selected model does not report image support. Choose an image-capable model before sending.');
    // Always declare queue behavior: the worker can start between the read and
    // prompt admission. This flag is also valid while the worker is idle.
    await this.mutate(command);
  }

  async abort(): Promise<void> {
    await this.getState();
    await this.mutate({ type: 'abort' });
  }

  /** Token, cost and context-window statistics. Read-only; identity is verified on both sides of the read. */
  async stats(): Promise<OwnedRpcStats> {
    await this.getState();
    const result: unknown = await this.rpc.request({ type: 'get_session_stats' }, false);
    await this.getState();
    return OwnedRpcSession.parseStats(result, this.id);
  }

  private static parseStats(value: unknown, sessionId: string): OwnedRpcStats {
    const count = (input: unknown): number => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : 0;
    if (!isRecord(value) || value.sessionId !== sessionId || !isRecord(value.tokens)) throw Error('Invalid owned session statistics.');
    const usage = isRecord(value.contextUsage) ? value.contextUsage : undefined;
    // After compaction the agent reports null until a fresh response arrives; keep that distinct from zero.
    const optional = (input: unknown): number | null => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
    return {
      userMessages: count(value.userMessages), assistantMessages: count(value.assistantMessages), toolCalls: count(value.toolCalls),
      tokens: { input: count(value.tokens.input), output: count(value.tokens.output), cacheRead: count(value.tokens.cacheRead), cacheWrite: count(value.tokens.cacheWrite), total: count(value.tokens.total) },
      cost: count(value.cost),
      ...(usage ? { context: { tokens: optional(usage.tokens), contextWindow: optional(usage.contextWindow), percent: optional(usage.percent) } } : {}),
    };
  }

  /**
   * Manual context compaction. It rewrites the agent's working context inside this
   * same persistent session; it is not a fork and never changes the session identity.
   */
  async compact(instructions?: string): Promise<{ tokensBefore: number | null }> {
    if (instructions !== undefined && (typeof instructions !== 'string' || Buffer.byteLength(instructions) > 16 * 1024 || instructions.includes('\0'))) throw Error('Compaction instructions must be text up to 16 KiB.');
    const state = await this.getState();
    if (state.isStreaming || state.isCompacting || state.unfinishedActionCount > 0 || state.sessionActions?.queuedCount > 0) {
      throw Error('Wait until the session is idle before compacting its context.');
    }
    const custom = instructions?.trim();
    // Summarizing a long transcript takes a model call; allow far longer than a state read.
    const result: unknown = await this.mutate({ type: 'compact', ...(custom ? { customInstructions: custom } : {}) }, 5 * 60_000);
    await this.getState();
    return { tokensBefore: isRecord(result) && typeof result.tokensBefore === 'number' ? result.tokensBefore : null };
  }

  async availableModels(): Promise<RecordValue[]> {
    await this.getState();
    const result: unknown = await this.rpc.request({ type: 'get_available_models' }, false);
    if (!isRecord(result) || !Array.isArray(result.models) || !result.models.every(model =>
      isRecord(model) && typeof model.id === 'string' && typeof model.provider === 'string')) {
      throw Error('Invalid owned RPC model catalog.');
    }
    return result.models;
  }

  async setModel(provider: string, modelId: string): Promise<RecordValue> {
    if (!provider.trim() || !modelId.trim()) throw Error('Provider and model ID are required.');
    const state = await this.getState();
    if (state.isStreaming || state.isCompacting || state.unfinishedActionCount > 0 || state.sessionActions?.queuedCount > 0) {
      throw Error('Wait until the session is idle before changing the model.');
    }
    const model: unknown = await this.mutate({ type: 'set_model', provider, modelId });
    if (!isRecord(model) || typeof model.id !== 'string' || typeof model.provider !== 'string') {
      this.freeze('Invalid model-change response. The session is closed.');
      throw Error('Invalid model-change response.');
    }
    return model;
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.unsubscribe();
      this.listeners.clear();
      this.closing = this.rpc.close();
    }
    return this.closing;
  }
}
