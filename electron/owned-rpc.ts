import { mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isRecord } from './bounded-io.js';
import { RpcClient, type RpcLaunch } from './rpc-client.js';

type RecordValue = Record<string, any>;
export interface OwnedRpcLaunch {
  executable: string;
  cwd: string;
  sessionDir: string;
  model?: string;
  socketPath?: string;
  timeoutMs?: number;
}
export interface OwnedRpcState extends RecordValue {
  sessionId: string;
  sessionFile: string;
  isStreaming: boolean;
  isCompacting: boolean;
}
export interface OwnedRpcTransport {
  readonly alive: boolean;
  request(command: RecordValue, mutation?: boolean): Promise<any>;
  onEvent(listener: (event: RecordValue) => void): () => void;
  close(): Promise<void>;
}
export type OwnedRpcFactory = (launch: RpcLaunch) => OwnedRpcTransport;

/**
 * A new root owned by one RPC stdin pipe, not a writable daemon selector.
 * Ownership (Prime Agent 0.9.6) is the safety boundary. State checks alone are
 * not atomic identity guards. Never add resume, navigation, or promotion here.
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

  private async mutate(command: RecordValue): Promise<any> {
    this.assertAlive();
    try { return await this.rpc.request(command, true); }
    catch (error) {
      // A missing admission response is not a rejection. Do not offer retry on
      // this pipe after an uncertain result, or automatically recreate it.
      if (!this.rpc.alive || (error instanceof Error && /uncertain/i.test(error.message))) {
        this.freeze('The last operation has an uncertain outcome. The session is closed; do not resend automatically.');
      }
      throw error;
    }
  }

  async send(message: string): Promise<void> {
    if (typeof message !== 'string' || !message.trim()) throw Error('Enter a message.');
    if (message.trimStart().startsWith('/')) throw Error('Slash commands are not supported in desktop-owned sessions.');
    if (Buffer.byteLength(message) > 512 * 1024) throw Error('Message exceeds the 512 KiB limit.');
    await this.getState();
    // Always declare queue behavior: the worker can start between the read and
    // prompt admission. This flag is also valid while the worker is idle.
    await this.mutate({ type: 'prompt', message, streamingBehavior: 'followUp' });
  }

  async abort(): Promise<void> {
    await this.getState();
    await this.mutate({ type: 'abort' });
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
