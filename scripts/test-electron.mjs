import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir = await mkdtemp(path.join(tmpdir(), 'dock-e2e-'));
const socketPath = path.join(dir, 'daemon.sock');
const sessionFile = path.join(dir, 'session.jsonl');
await writeFile(sessionFile, JSON.stringify({ type: 'session', id: 'fixture' }) + '\n' + JSON.stringify({ type: 'message', id: 'm', parentId: null, message: { role: 'assistant', content: 'Native integration fixture' } }) + '\n');
const commands = [], sockets = new Set();
const server = createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
  socket.setEncoding('utf8');
  socket.write(JSON.stringify({ type: 'daemon_hello', protocol: { name: 'prime-agent.daemon', version: 7 }, schemaRevision: 28, appVersion: 'fixture' }) + '\n');
  let buffer = '';
  socket.on('data', chunk => { buffer += chunk; let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      const command = request.command; commands.push(command.type);
      const success = command.type === 'list';
      socket.write(JSON.stringify({ type: 'response', id: request.id, success, ...(success ? { data: { sessions: [{ sessionId: 'fixture', activeSessionId: 'runtime', sessionFile, cwd: dir, sessionName: 'Fixture session' }] } } : { error: 'Unexpected mutation' }) }) + '\n');
    }
  });
});
const executable = process.env.PRIME_DESKTOP_EXECUTABLE ? path.resolve(process.env.PRIME_DESKTOP_EXECUTABLE) : undefined;
const app = await electron.launch({ ...(executable ? { executablePath: executable, args: [`--user-data-dir=${path.join(dir, 'profile')}`] } : { args: ['.', `--user-data-dir=${path.join(dir, 'profile')}`] }), env: { ...process.env, PRIME_DESKTOP_SOCKET: socketPath, PRIME_AGENT_BIN: path.join(dir, 'missing-cli'), PRIME_DESKTOP_DEV_URL: '' } });
let original;
try {
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.prime);
  expect((await page.evaluate(() => window.prime.status())).connected).toBe(false);
  const missing = await page.evaluate(() => window.prime.connect());
  expect(missing.connected).toBe(false); expect(missing.error).toContain('Could not start');
  await new Promise(resolve => server.listen(socketPath, resolve));
  expect((await page.evaluate(() => window.prime.connect())).connected).toBe(true);
  const status = await page.evaluate(() => window.prime.status()); expect(status.readOnly).toBe(true);
  const sessions = await page.evaluate(() => window.prime.listSessions()); expect(sessions[0].id).toBe('fixture');
  expect((await page.evaluate(() => window.prime.getMessages('fixture')))[0].content).toBe('Native integration fixture');
  for (const method of ['sendMessage', 'renameSession', 'deleteSession', 'interruptSession']) await expect(page.evaluate(method => window.prime[method]('fixture', 'no'), method)).rejects.toThrow(/Read-only compatibility/);
  await expect(page.evaluate(() => window.prime.createSession({ cwd: '/', prompt: 'no' }))).rejects.toThrow(/Read-only compatibility/);
  await expect(page.evaluate(() => window.prime.getMessages(42))).rejects.toThrow(/Invalid session ID/);
  original = await app.evaluate(async ({ clipboard }) => await clipboard.readText());
  await page.evaluate(() => window.prime.copyText('Clipboard fixture'));
  expect(await app.evaluate(async ({ clipboard }) => await clipboard.readText())).toBe('Clipboard fixture');
  await expect(page.evaluate(() => window.prime.copyText(null))).rejects.toThrow(/Invalid clipboard text/);
  expect(await page.evaluate(() => [typeof window.require, typeof window.process])).toEqual(['undefined', 'undefined']);
  const before = page.url();
  await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.invalid/'; a.textContent = 'Navigation probe'; document.body.append(a); a.click(); a.remove(); });
  expect(page.url()).toBe(before);
  // The native picker can be stubbed in main; renderer still exercises the bridge.
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/tmp'] }); });
  expect(await page.evaluate(() => window.prime.chooseDirectory())).toBe('/tmp');
  await app.evaluate(async ({ clipboard }, value) => await clipboard.writeText(value), original); original = undefined;
  await app.close();
  expect(server.listening).toBe(true);
  expect(commands.every(type => type === 'list')).toBe(true);
  console.log('Isolated Electron integration passed: cold start, reconnect, IPC, clipboard, navigation, dialogs, read-only safety, detach');
} finally {
  if (original !== undefined) await app.evaluate(async ({ clipboard }, value) => await clipboard.writeText(value), original).catch(() => {});
  await app.close().catch(() => {}); for (const socket of sockets) socket.destroy();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
