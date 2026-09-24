import { _electron as electron } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const app = await electron.launch({ ...(process.env.PRIME_DESKTOP_EXECUTABLE ? { executablePath: process.env.PRIME_DESKTOP_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, PRIME_DESKTOP_DEV_URL: '' } });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.prime);
  const result = await page.evaluate(async () => {
    if (typeof window.require !== 'undefined' || typeof window.process !== 'undefined') throw new Error('Renderer has Node access');
    const status = await window.prime.status();
    if (!status.connected) throw new Error(status.error || 'Prime Agent is not connected');
    const sessions = await window.prime.listSessions();
    const transcript = sessions.length ? await window.prime.getMessages(sessions[0].id) : [];
    return { connected: status.connected, version: status.version, sessionCount: sessions.length, firstTranscriptMessages: transcript.length };
  });
  await page.getByRole('button', { name: /new session/i }).first().waitFor();
  await page.getByText('Loading sessions...').waitFor({ state: 'hidden' });
  await page.evaluate(() => document.fonts.ready);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/desktop.png' });
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
