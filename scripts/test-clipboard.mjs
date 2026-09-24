import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(tmpdir(), 'session-dock-clipboard-'));
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] });
const original = await app.evaluate(async ({ clipboard }) => await clipboard.readText());
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.prime);
  await page.evaluate(() => window.prime.copyText('Session Dock clipboard test'));
  expect(await app.evaluate(async ({ clipboard }) => await clipboard.readText())).toBe('Session Dock clipboard test');
  await expect(page.evaluate(() => window.prime.copyText(42))).rejects.toThrow(/Invalid clipboard text/);
  console.log('Native clipboard bridge passed');
} finally {
  await app.evaluate(async ({ clipboard }, text) => await clipboard.writeText(text), original);
  await app.close(); await rm(profile, { recursive: true, force: true });
}
