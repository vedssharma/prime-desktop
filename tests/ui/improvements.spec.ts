import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const sessions = [
      { id: 'owned', title: 'Owned session', cwd: '/tmp/owned', model: 'test/chosen', status: 'idle', createdAt: now, updatedAt: now, ownership: 'desktop', writable: true, lifecycle: 'open' },
      { id: 'shared', title: 'Shared session', cwd: '/tmp/shared', model: '', status: 'idle', createdAt: now, updatedAt: now, ownership: 'shared', writable: false },
    ];
    const messages: Record<string, any[]> = { owned: [], shared: [] };
    (window as any).__calls = [];
    (window as any).__messages = messages;
    (window as any).prime = {
      status: async () => ({ connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions,
      listModels: async () => [{ id: 'test/first', name: 'First model' }, { id: 'test/chosen', name: 'Chosen model' }],
      getMessages: async (id: string) => [...(messages[id] || [])], // IPC returns a fresh copy
      createSession: async () => { throw Error('not used'); },
      setSessionModel: async (id: string, model: string) => { (window as any).__calls.push(['model', id, model]); },
      closeOwnedSession: async () => { throw Error('Owned process did not exit'); },
      sendMessage: async () => {},
      interruptSession: async () => {},
      getSessionUsage: async () => ({ userMessages: 1, assistantMessages: 1, toolCalls: 2, tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, total: 1500 }, cost: 0.0042, context: { tokens: 1500, contextWindow: 200000, percent: 0.75 } }),
      compactSession: async (id: string, instructions?: string) => { (window as any).__calls.push(['compact', id, instructions]); return { tokensBefore: 1500 }; },
      renameSession: async () => {},
      deleteSession: async () => {},
      copyText: async (text: string) => { (window as any).__calls.push(['copy', text]); },
      chooseDirectory: async () => '/tmp/chosen-workspace',
      openDirectory: async () => {},
    };
  });
});

const open = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
};
const select = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(name) }).click();
const modelSelect = (page: Page) => page.getByRole('combobox', { name: 'Model', exact: true });

test('the hidden new-session model search never filters an open session selector', async ({ page }) => {
  await open(page);
  await page.getByRole('textbox', { name: 'Search models' }).fill('first');
  await expect(modelSelect(page).locator('option')).toHaveCount(2);
  await select(page, 'Owned session');
  await expect(page.getByRole('textbox', { name: 'Search models' })).toHaveCount(0);
  await expect(modelSelect(page)).toHaveValue('test/chosen');
  await expect(modelSelect(page).locator('option')).toHaveText(['CLI default', 'First model', 'Chosen model']);
});

test('a failed close reports a close error, not a rename error', async ({ page }) => {
  await open(page);
  await select(page, 'Owned session');
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Close desktop session' }).click();
  await page.getByRole('button', { name: 'Close and stop' }).click();
  await expect(page.locator('.error-banner')).toContainText('Close session: Owned process did not exit');
});

test('an error from one session is cleared when switching to another', async ({ page }) => {
  await open(page);
  await select(page, 'Owned session');
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Close desktop session' }).click();
  await page.getByRole('button', { name: 'Close and stop' }).click();
  await expect(page.locator('.error-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await select(page, 'Shared session');
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

for (const [platform, shortcut] of [['MacIntel', '⌘ N'], ['Linux x86_64', 'Ctrl N']] as const) {
  test(`shortcut hints match the platform: ${platform}`, async ({ page }) => {
    await page.addInitScript(value => Object.defineProperty(navigator, 'platform', { get: () => value }), platform);
    await open(page);
    await expect(page.locator('.new-session-button kbd')).toHaveText(shortcut);
    await page.getByRole('button', { name: 'About Session Dock', exact: true }).click();
    await expect(page.locator('.about-shortcut kbd').first()).toHaveText(shortcut);
  });
}

test('code blocks copy exactly their displayed code through the native bridge', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__messages.owned.push({ id: 'a1', role: 'assistant', content: 'Run this:\n\n```sh\nnpm ci\nnpm run dev\n```\n\nThen reload.' }); });
  await open(page);
  await select(page, 'Owned session');
  const block = page.locator('.code-block');
  await block.hover();
  await block.getByRole('button', { name: 'Copy code' }).click();
  await expect(block.getByRole('button', { name: 'Code copied' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls)).toContainEqual(['copy', 'npm ci\nnpm run dev']);
  await page.evaluate(() => { (window as any).prime.copyText = async () => { throw Error('Clipboard unavailable'); }; });
  await expect(block.getByRole('button', { name: 'Copy code' })).toBeVisible();
  await block.getByRole('button', { name: 'Copy code' }).click();
  await expect(block.getByRole('alert')).toHaveText('Copy failed: Clipboard unavailable');
});

test('opening a session lands on the latest output; scrolling away offers Jump to latest', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__messages.owned.push(...Array.from({ length: 40 }, (_, i) => ({ id: `long-${i}`, role: 'assistant', content: `Paragraph ${i}\n\nSome longer response text for scrolling.` }))); });
  await open(page);
  // The trust checkbox makes the welcome page scrollable; its scroll position must not leak into the session.
  await page.locator('.content-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await select(page, 'Owned session');
  await expect(page.getByText('Paragraph 39')).toBeInViewport();
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  await expect(jump).toHaveCount(0);
  await page.locator('.content-scroll').evaluate(node => { node.scrollTop = 0; });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect(page.getByText('Paragraph 39')).toBeInViewport();
});

test('message times include the date for messages from earlier days', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__messages.owned.push(
    { id: 'old', role: 'user', content: 'Older question', timestamp: '2024-03-05T12:00:00.000Z' },
    { id: 'new', role: 'assistant', content: 'Fresh answer', timestamp: new Date().toISOString() },
  ); });
  await open(page);
  await select(page, 'Owned session');
  const old = page.locator('.message', { hasText: 'Older question' }).locator('time');
  await expect(old).toContainText('Mar 5, 2024');
  await expect(old).toHaveAttribute('datetime', '2024-03-05T12:00:00.000Z');
  await expect(page.locator('.message', { hasText: 'Fresh answer' }).locator('time')).toHaveText(/^\d{1,2}:\d{2}/);
});

test('an owned session shows usage and compacts on demand; shared sessions do not', async ({ page }) => {
  await open(page);
  await select(page, 'Owned session');
  await page.getByText('Work & queue status').click();
  await expect(page.getByText(/1,500 tokens/)).toBeVisible();
  await expect(page.getByText(/Context: 1,500 of 200,000 tokens \(1%\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Compact context' }).click();
  await expect(page.getByText(/Context compacted from about 1,500 tokens/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.filter((call: any[]) => call[0] === 'compact'))).toEqual([['compact', 'owned', undefined]]);
  await select(page, 'Shared session');
  await page.getByText('Work & queue status').click();
  await expect(page.getByRole('button', { name: 'Compact context' })).toHaveCount(0);
});


test('custom compaction instructions are trimmed, bounded and sent only on request', async ({page}) => {
  await open(page);await select(page,'Owned session');
  await page.getByText('Work & queue status').click();
  const instructions=page.getByRole('textbox',{name:'Compaction instructions (optional)'});
  await instructions.fill('  Preserve file paths and test failures.  ');
  expect(await page.evaluate(()=>(window as any).__calls.filter((call:any[])=>call[0]==='compact'))).toEqual([]);
  await page.getByRole('button',{name:'Compact context'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__calls.filter((call:any[])=>call[0]==='compact'))).toEqual([['compact','owned','Preserve file paths and test failures.']]);
  await instructions.fill('é'.repeat(8193));
  await expect(page.getByText('Compaction instructions must fit within 16 KiB.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Compact context'})).toBeDisabled();
  await select(page,'Shared session');
  await expect(instructions).toHaveCount(0);
});
