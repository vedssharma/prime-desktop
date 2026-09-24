import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function fakeDaemon(handler: (command: any) => any = () => ({}), hello: any = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'prime-desktop-test-'));
  const socketPath = join(directory, 'daemon.sock');
  const commands: any[] = [];
  const envelopes: any[] = [];
  const clients = new Set<Socket>();
  const server = createServer(socket => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write(JSON.stringify({ type: 'daemon_hello', protocol: { name: 'prime-agent.daemon', version: 7 }, schemaRevision: 28, version: '0.9.5', serverCapabilities: ['session_input_admission'], ...hello }) + '\n');
    let buffer = '';
    socket.on('data', data => {
      buffer += data;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const wire = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        envelopes.push(wire);
        const command = wire.command;
        commands.push(command);
        if (command.type === 'ack_result') continue;
        Promise.resolve().then(() => handler(command)).then(data => {
          if (data === 'disconnect') { socket.destroy(); return; }
          if (data === 'no_response') return;
          socket.write(JSON.stringify({ type: 'response', id: wire.id, success: true, data }) + '\r\n');
        }, error => socket.write(JSON.stringify({ type: 'response', id: wire.id, success: false, error: error.message }) + '\n'));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  return { socketPath, directory, commands, envelopes, close: async () => {
    for (const socket of clients) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}
