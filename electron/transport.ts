import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { isRecord, JsonlDecoder } from './bounded-io.js';

export type WireRecord = Record<string, any>;
export interface DaemonHello extends WireRecord {
  type: 'daemon_hello';
  protocol: { name: string; version: number };
  schemaRevision?: number;
  schemaId?: string;
  version?: string;
  serverCapabilities?: string[];
}
const READ_ONLY = new Set(['list', 'list_saved_sessions', 'get_state', 'get_messages', 'get_available_models', 'get_model_catalog', 'get_session_tree', 'get_session_context']);

/** Local, owner-only Unix socket. This is NOT the private authenticated worker socket.
 * Contract verified against Prime Agent 0.9.5's bundled daemon-client/protocol source.
 * Never retries a mutation: loss of its response means the outcome is uncertain.
 */
export class DaemonTransport {
  readonly clientId = `prime-desktop:${randomUUID()}`;
  hello?: DaemonHello;
  private socket?: Socket;
  private connecting?: Promise<DaemonHello>;
  private pending = new Map<string, { resolve: (value: WireRecord) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; mutation: boolean }>();
  constructor(readonly socketPath: string, private timeoutMs = 30_000) {}
  get connected() { return !!this.socket && !this.socket.destroyed && !!this.hello; }

  connect(): Promise<DaemonHello> {
    if (this.connected) return Promise.resolve(this.hello!);
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private open(): Promise<DaemonHello> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      this.socket = socket;
      this.hello = undefined;
      const decoder = new JsonlDecoder();
      const timer = setTimeout(() => fail(new Error('Timed out waiting for the Prime Agent daemon handshake.')), Math.min(this.timeoutMs, 5000));
      let failed = false;
      const fail = (error: Error) => {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        socket.destroy();
        // A retired socket may emit close after a replacement is already open.
        if (this.socket !== socket) { reject(error); return; }
        this.socket = undefined;
        this.hello = undefined;
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error(request.mutation ? `${error.message} The command outcome is uncertain. Refresh before trying again.` : error.message));
        }
        this.pending.clear();
        reject(error);
      };
      socket.on('error', fail);
      socket.on('close', () => fail(new Error('Prime Agent daemon disconnected.')));
      socket.on('data', (chunk: Buffer) => {
        try {
          decoder.feed(chunk, line => {
            if (failed || this.socket !== socket) return;
            let record: unknown;
            try { record = JSON.parse(line); } catch { throw new Error('Invalid JSON from Prime Agent daemon.'); }
            if (!isRecord(record) || typeof record.type !== 'string') throw new Error('Invalid daemon record.');
            if (record.type === 'daemon_hello') {
              if (this.hello) throw new Error('Duplicate daemon handshake.');
              if (!isRecord(record.protocol) || record.protocol.name !== 'prime-agent.daemon' || record.protocol.version !== 7 || !Number.isInteger(record.schemaRevision) || record.schemaRevision < 28) {
                throw new Error(`Unsupported Prime Agent daemon protocol ${record.protocol?.version ?? '?'} / schema ${record.schemaRevision ?? '?'}.`);
              }
              if (record.serverCapabilities !== undefined && (!Array.isArray(record.serverCapabilities) || !record.serverCapabilities.every((item: unknown) => typeof item === 'string'))) throw new Error('Invalid daemon capabilities.');
              this.hello = record as DaemonHello; clearTimeout(timer); resolve(this.hello);
            } else if (record.type === 'response') {
              if (!this.hello || typeof record.id !== 'string' || typeof record.success !== 'boolean' || (record.error !== undefined && typeof record.error !== 'string') || (record.data !== undefined && !isRecord(record.data))) throw new Error('Invalid daemon response.');
              const request = this.pending.get(record.id);
              if (!request) return;
              this.pending.delete(record.id); clearTimeout(request.timer);
              if (request.mutation) this.write({ type: 'ack_result', commandId: record.id });
              if (record.success) request.resolve(record.data ?? {});
              else request.reject(new Error(record.error ?? 'Prime Agent rejected the request.'));
            }
          });
        } catch (error) { fail(error instanceof Error ? error : new Error('Invalid daemon data.')); }
      });
    });
  }

  private write(command: WireRecord, id = randomUUID()): void {
    this.socket!.write(JSON.stringify({ type: 'command', id, protocol: { name: 'prime-agent.daemon', version: 7 }, clientId: this.clientId, command: { ...command, id } }) + '\n');
  }

  async request(command: WireRecord, timeoutMs = this.timeoutMs): Promise<WireRecord> {
    await this.connect();
    if (command.type === 'prompt' && !this.hello?.serverCapabilities?.includes('session_input_admission')) throw new Error('This daemon does not support session prompt admission.');
    const id = randomUUID();
    const mutation = !READ_ONLY.has(command.type);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Prime Agent ${command.type} timed out.${mutation ? ' Its outcome is uncertain. Refresh before trying again.' : ''}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, mutation });
      this.write(command, id);
    });
  }
  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.hello = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Desktop connection closed.'));
    }
    this.pending.clear();
    socket?.destroy(); // Resident workers remain alive. Never send kill/shutdown here.
  }
}
