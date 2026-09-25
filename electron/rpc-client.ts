import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { JsonlDecoder, isRecord } from './bounded-io.js';

export interface RpcLaunch { executable: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; }
type RecordValue = Record<string, any>;
export function rpcEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('PRIME_AGENT_INTERNAL_') && !['PI_STARTUP_BENCHMARK', 'NODE_OPTIONS', 'BUN_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key)));
}
/** One owned stdin/stdout connection. No routing by public daemon session ID. */
export class RpcClient {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; mutation: boolean; command: string }>();
  private ended = false;
  private stopping = false;
  private closePromise?: Promise<void>;
  private exitPromise: Promise<void>;
  private reason = 'RPC process is not running.';
  private listeners = new Set<(event: RecordValue) => void>();
  constructor(private launch: RpcLaunch) {
    this.child = spawn(launch.executable, launch.args, { cwd: launch.cwd, env: rpcEnvironment(launch.env ?? process.env), stdio: 'pipe', shell: false });
    this.exitPromise = new Promise(resolve => this.child.once('close', () => resolve()));
    const decoder = new JsonlDecoder(16 * 1024 * 1024);
    this.child.stdout.on('data', (chunk: Buffer) => {
      try { decoder.feed(chunk, line => this.receive(line)); }
      catch { this.fail('Invalid or oversized response from the owned RPC process.'); this.child.kill(); }
    });
    // Do not expose or retain arbitrary stderr: extensions/providers may print secrets.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.fail('RPC input disconnected.'));
    this.child.on('error', error => this.fail(`Could not start Prime Agent RPC (${(error as NodeJS.ErrnoException).code ?? 'process error'}). Check the CLI path.`));
    this.child.on('close', () => this.fail('Prime Agent RPC process exited. This session was not automatically restarted.'));
  }
  get alive() { return !this.ended && !this.stopping; }
  onEvent(listener: (event: RecordValue) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private receive(line: string) {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value) || typeof value.type !== 'string') throw Error('Invalid RPC record');
    if (value.type !== 'response') { for (const listener of this.listeners) listener(value); return; }
    if (typeof value.id !== 'string' || typeof value.success !== 'boolean' || typeof value.command !== 'string') throw Error('Invalid RPC response');
    const request = this.pending.get(value.id);
    if (!request) return;
    if (request.command !== value.command) throw Error('RPC correlation mismatch');
    this.pending.delete(value.id); clearTimeout(request.timer);
    if (value.success) request.resolve(value.data);
    else request.reject(Error(typeof value.error === 'string' ? value.error : 'Prime Agent rejected the request.'));
  }
  private fail(reason: string) {
    if (this.ended) return;
    this.ended = true; this.reason = reason;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error(reason + (request.mutation ? ' The outcome is uncertain. Do not resend automatically.' : '')));
    }
    this.pending.clear(); this.listeners.clear();
  }
  async request(command: RecordValue, mutation = true): Promise<any> {
    if (!this.alive) throw Error(this.reason);
    if (typeof command.type !== 'string') throw Error('Invalid RPC command');
    const id = randomUUID();
    const wire = JSON.stringify({ ...command, id }) + '\n';
    if (Buffer.byteLength(wire) > 1024 * 1024) throw Error('RPC command exceeds the 1 MiB limit.');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`RPC ${command.type} timed out.${mutation ? ' Its outcome is uncertain. Do not resend automatically.' : ''}`));
      }, this.launch.timeoutMs ?? 30000);
      this.pending.set(id, { resolve, reject, timer, mutation, command: command.type });
      this.child.stdin.write(wire, error => { if (error) this.fail('RPC input disconnected.'); });
    });
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopping = true;
    this.closePromise = (async () => {
      this.child.stdin.end();
      const terminate = setTimeout(() => this.child.kill('SIGTERM'), 1500);
      const force = setTimeout(() => this.child.kill('SIGKILL'), 3500);
      try { await this.exitPromise; } finally { clearTimeout(terminate); clearTimeout(force); this.fail('Owned RPC session closed.'); }
    })();
    return this.closePromise;
  }
}
