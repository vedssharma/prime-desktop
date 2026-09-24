import { spawn } from 'node:child_process';
import { createServer } from 'vite';
const compile = spawn('npx', ['tsc', '-p', 'tsconfig.electron.json'], { stdio: 'inherit', shell: process.platform === 'win32' });
compile.on('exit', async (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const server = await createServer();
  await server.listen();
  const { default: electron } = await import('electron');
  const child = spawn(electron, ['.'], {
    stdio: 'inherit', env: { ...process.env, PRIME_DESKTOP_DEV_URL: 'http://127.0.0.1:5173' },
  });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; child.kill(); await server.close(); };
  child.on('exit', async (code) => { await stop(); process.exit(code ?? 0); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
});
