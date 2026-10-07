import { test, expect, type Page } from './fixtures';

// Smaller views and their edge cases: connection settings, usage, message kinds, palette and dialogs.
async function setup(page: Page, overrides = '') {
  await page.addInitScript(() => {
    const session = { id: 'owned', title: 'Owned task', cwd: '/tmp/project', model: '', status: 'idle', createdAt: '', updatedAt: '', ownership: 'desktop', writable: true, lifecycle: 'open' };
    (window as any).__messages = [{ id: 'm1', role: 'user', content: 'Hello' }];
    (window as any).__calls = [];
    const log = (...args: any[]) => (window as any).__calls.push(args);
    (window as any).__log = log;
    (window as any).prime = {
      status: async () => ({ connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }),
      connect: async () => { log('connect'); return { connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }; },
      listSessions: async () => [session],
      listModels: async () => [],
      getMessages: async () => [...(window as any).__messages],
      sendMessage: async () => {}, interruptSession: async () => {}, closeOwnedSession: async () => {},
      getSessionUsage: async () => ({ userMessages: 1, assistantMessages: 1, toolCalls: 1, tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, total: 15 }, cost: 0.001, context: { tokens: null, contextWindow: null, percent: null } }),
      compactSession: async () => ({ tokensBefore: null }),
      copyText: async () => {},
      notify: async () => {}, onNotificationClick: () => () => {},
    };
  });
  if (overrides) await page.addInitScript(overrides);
  await page.goto('/');
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
}
const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: /settings/i }).first().click();
  await page.getByText('Connection & setup').click();
};

test('connection settings load the saved paths, save edits and reconnect', async ({ page }) => {
  await setup(page, `
    window.prime.getConnectionConfig = async () => ({ executable: '/opt/prime/bin/prime-agent', socketPath: '' });
    window.prime.configureConnection = async config => { window.__log('configure', config); };`);
  await openSettings(page);
  const executable = page.getByRole('textbox', { name: 'CLI executable' });
  await expect(executable).toHaveValue('/opt/prime/bin/prime-agent');
  await page.getByRole('textbox', { name: 'Daemon socket' }).fill('/tmp/custom.sock');
  await page.getByRole('button', { name: 'Save & reconnect' }).click();
  await expect(page.getByText('Connection settings saved. Check the connection status.')).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls).toContainEqual(['configure', { executable: '/opt/prime/bin/prime-agent', socketPath: '/tmp/custom.sock' }]);
  expect(calls.findIndex((call: any[]) => call[0] === 'connect')).toBeGreaterThan(calls.findIndex((call: any[]) => call[0] === 'configure'));
});

test('connection settings report load and save failures without reconnecting', async ({ page }) => {
  await setup(page, `
    window.prime.getConnectionConfig = async () => { throw new Error('settings file unreadable'); };
    window.prime.configureConnection = async () => { throw new Error('Executable must be an absolute path.'); };`);
  await openSettings(page);
  await expect(page.getByText('Error: settings file unreadable')).toBeVisible();
  await page.getByRole('textbox', { name: 'CLI executable' }).fill('prime-agent');
  await page.getByRole('button', { name: 'Save & reconnect' }).click();
  await expect(page.getByText('Error: Executable must be an absolute path.')).toBeVisible();
  expect((await page.evaluate(() => (window as any).__calls)).filter((call: any[]) => call[0] === 'connect')).toEqual([]);
});

test('usage shows tiny costs, unknown context size, and failures to read usage or compact', async ({ page }) => {
  await setup(page, `
    let usageFails = false;
    window.__failUsage = () => { usageFails = true; };
    const usage = window.prime.getSessionUsage;
    window.prime.getSessionUsage = async id => { if (usageFails) throw new Error('usage RPC timed out'); return usage(id); };
    let compactions = 0;
    window.prime.compactSession = async () => { if (++compactions > 1) throw new Error('Nothing to compact'); return { tokensBefore: null }; };`);
  await page.getByRole('button', { name: /Owned task/ }).click();
  await page.getByText('Work & queue status').click();
  await expect(page.getByText('15 tokens (10 in, 5 out, 2 cached) · <$0.01 estimated · 1 tool call', { exact: true })).toBeVisible();
  await expect(page.getByText('Context size will be estimated after the next response.')).toBeVisible();
  await page.getByRole('button', { name: 'Compact context' }).click();
  await expect(page.getByText('Context compacted.', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__failUsage());
  await page.getByRole('button', { name: 'Compact context' }).click();
  await expect(page.locator('.error-banner')).toContainText('Compact context: Nothing to compact');
  await expect(page.getByText('Usage is unavailable: usage RPC timed out')).toBeVisible();
});

test('system notes, empty tool output, inline code and unreadable images render safely', async ({ page }) => {
  await setup(page, `
    window.__messages = [
      { id: 'm1', role: 'user', content: 'Run it' },
      { id: 'm2', role: 'system', content: 'Session compacted by the agent.' },
      { id: 'm3', role: 'tool', toolName: '', content: '' },
      { id: 'm4', role: 'assistant', content: 'Use \`npm test\` here.', images: [{ type: 'image', mimeType: 'image/gif', data: 'AAAA' }] },
    ];`);
  await page.getByRole('button', { name: /Owned task/ }).click();
  await expect(page.locator('.system-message')).toHaveText('Session compacted by the agent.');
  await page.getByText('Thought process').click();
  await page.locator('details.tool-message summary').click();
  await expect(page.locator('details.tool-message summary')).toContainText('Tool call');
  await expect(page.locator('details.tool-message pre')).toHaveText('No output');
  await expect(page.locator('.message.assistant code')).toHaveText('npm test');
  await expect(page.locator('.message.assistant .tok-keyword')).toHaveCount(0);
  await expect(page.getByText('Image attachment unavailable.')).toBeVisible();
});

test('the palette says when nothing matches and runs a command picked with the mouse', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Search commands and sessions' });
  await input.fill('zzzz-no-command');
  await expect(page.getByText('No matching commands')).toBeVisible();
  // Arrow keys with no results are harmless.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await input.fill('About');
  const option = page.locator('#palette-list [role=option]', { hasText: 'About Session Dock' });
  await option.hover();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await option.click();
  await expect(page.getByRole('heading', { name: 'Your agent. At home on your desktop.' })).toBeVisible();
});

test('clicking outside a dialog closes it, and the narrow sidebar backdrop closes the drawer', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.setViewportSize({ width: 760, height: 560 });
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.locator('.sidebar-backdrop').click({ position: { x: 740, y: 280 } });
  await expect(page.locator('aside')).toHaveAttribute('inert', '');
});
