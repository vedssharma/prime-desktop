// Opt-in native ownership check. No prompt is sent and no credentials are inherited.
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const binary = process.argv[2];
if (!binary) throw Error('Usage: node probe.mjs /absolute/prime-agent [report.json]');
const directory = await mkdtemp(join(tmpdir(), 'sd-rpc-probe-'));
const home = join(directory, 'home'), agentDir = join(directory, 'agent'), sessions = join(directory, 'sessions');
const socketPath = join(directory, 'd.sock');
await Promise.all([home, agentDir, sessions].map(path => mkdir(path, { mode: 0o700 })));
const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, TMPDIR: directory,
  PRIME_AGENT_CODING_AGENT_DIR: agentDir, PRIME_AGENT_SESSION_DIR: sessions,
  PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_REGISTRY_DIR: join(directory, 'owners'),
  PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', NO_COLOR: '1', TERM: 'dumb' };
const common = ['--cwd', directory, '--daemon-socket', socketPath, '--session-dir', sessions,
  '--offline', '--no-extensions', '--no-tools', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes',
  '--model', 'anthropic/claude-haiku-4-5'];
const children = [];
function launch(mode) {
  const child = spawn(binary, ['--mode', mode, ...common], { env, cwd: directory, stdio: 'pipe' });
  child.done = once(child, 'close');
  child.stderrText = '';
  child.stderr.on('data', data => { child.stderrText = (child.stderrText + data.toString()).slice(-10000); });
  children.push(child); return child;
}
const deadline = (promise, ms, message) => {
  let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]).finally(() => clearTimeout(timer));
};
function channel(input, output, daemon = false) {
  let buffer = ''; const pending = new Map(); let nextId = 0; const unsolicited = [];
  input.on('data', chunk => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const offset = buffer.indexOf('\n'), line = buffer.slice(0, offset); buffer = buffer.slice(offset + 1);
      if (!line.trim()) continue;
      const value = JSON.parse(line); const waiter = pending.get(value.id);
      if (waiter) { pending.delete(value.id); waiter(value); } else unsolicited.push(value);
    }
  });
  return { unsolicited, async request(command) { const id = `probe-${++nextId}`;
    const response = new Promise(resolve => pending.set(id, resolve));
    const wire = { ...command, id };
    output.write(JSON.stringify(daemon ? { type: 'command', id, protocol: { name: 'prime-agent.daemon', version: 7 }, clientId: 'isolated-peer', command: wire } : wire) + '\n');
    return deadline(response, 20000, `No response to ${command.type}`);
  } };
}
async function connect() {
  const start = Date.now();
  while (true) {
    const socket = createConnection(socketPath);
    try { await once(socket, 'connect'); return socket; }
    catch (error) { socket.destroy(); if (Date.now() - start > 20000) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
}
let supervisor, rpc, peer;
const report = { binary, noPrompts: true, noCredentials: true, isolated: true };
try {
  const versionProcess = spawn(binary, ['--version'], { env, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  versionProcess.done = once(versionProcess, 'close'); children.push(versionProcess);
  let versionText = ''; versionProcess.stdout.on('data', chunk => { versionText += chunk.toString(); });
  versionProcess.stderr.resume();
  await deadline(versionProcess.done, 10000, 'Version check timed out');
  report.version = versionText.trim();
  assert.equal(report.version, '0.9.6', 'This ownership probe is pinned to the reviewed version');
  supervisor = launch('daemon');
  peer = await connect();
  const peerChannel = channel(peer, peer, true);
  // Initial daemon requests may wait for startup; only disposable daemon addressed.
  const listed = await peerChannel.request({ type: 'list', all: true });
  assert.equal(listed.success, true, JSON.stringify(listed));
  rpc = launch('rpc');
  const rpcChannel = channel(rpc.stdout, rpc.stdin);
  const stateResponse = await rpcChannel.request({ type: 'get_state' });
  assert.equal(stateResponse.success, true, JSON.stringify(stateResponse));
  const state = stateResponse.data;
  assert.equal(typeof state.sessionId, 'string');
  assert.equal(typeof state.sessionFile, 'string');
  assert.equal(state.sessionFile.startsWith(sessions + '/'), true);
  report.state = { sessionId: state.sessionId, sessionFile: state.sessionFile, isStreaming: state.isStreaming, modelId: state.model?.id };
  const messages = await rpcChannel.request({ type: 'get_messages' });
  assert.equal(messages.success, true); assert.equal(messages.data.messages.length, 0);
  const descriptorDirs = await readdir(join(agentDir, 'daemon-workers'));
  let descriptor;
  for (const dir of descriptorDirs) for (const file of await readdir(join(agentDir, 'daemon-workers', dir))) {
    if (!file.endsWith('.json')) continue;
    const value = JSON.parse(await readFile(join(agentDir, 'daemon-workers', dir, file), 'utf8'));
    if (value.rootSessionId === state.sessionId || value.sessionFile === state.sessionFile) descriptor = value;
  }
  assert.ok(descriptor, 'Owned worker descriptor exists');
  assert.equal(typeof descriptor.ownerClientId, 'string');
  report.clientOwned = true;
  report.peerDenials = [];
  for (const activeSessionId of [descriptor.rootActiveSessionId, state.sessionId]) {
    for (const type of ['get_state', 'new_session']) {
      const result = await peerChannel.request({ type, activeSessionId });
      assert.equal(result.success, false, JSON.stringify(result));
      assert.match(result.error, /Unknown active session/);
      report.peerDenials.push({ type, selector: activeSessionId === state.sessionId ? 'persistent' : 'active', error: result.error });
    }
  }
  const unchanged = await rpcChannel.request({ type: 'get_state' });
  assert.equal(unchanged.data.sessionId, state.sessionId);
  report.identityUnchanged = true;
  rpc.stdin.end();
  const [rpcExit] = await deadline(rpc.done, 20000, 'RPC EOF did not exit');
  assert.equal(rpcExit, 0, rpc.stderrText);
  report.rpcEofExit = rpcExit;
  const remaining = [];
  for (const dir of descriptorDirs) for (const file of await readdir(join(agentDir, 'daemon-workers', dir))) if (file.endsWith('.json')) remaining.push(file);
  assert.equal(remaining.length, 0, JSON.stringify(remaining));
  report.workerRemoved = true;
  try { const data = await readFile(state.sessionFile, 'utf8'); report.savedHeaderId = JSON.parse(data.split('\n')[0]).id; }
  catch (error) { if (error.code === 'ENOENT') report.fileNotYetWrittenWithoutPrompt = true; else throw error; }
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  console.error(error); console.error('RPC stderr:', rpc?.stderrText); console.error('Supervisor stderr:', supervisor?.stderrText); process.exitCode = 1;
} finally {
  peer?.destroy();
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGTERM');
    try { await deadline(child.done, 10000, 'cleanup timeout'); } catch { child.kill('SIGKILL'); await deadline(child.done, 5000, 'force cleanup timeout'); }
  }
  await rm(directory, { recursive: true, force: true });
}
