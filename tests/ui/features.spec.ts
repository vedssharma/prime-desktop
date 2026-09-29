import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const sessions = [
      { id: 's1', title: 'Explore the workspace', cwd: '/tmp/project', model: 'test/model', status: 'idle', createdAt: now, updatedAt: now },
      { id: 's2', title: 'Second task', cwd: '/tmp/other', model: 'test/model', status: 'idle', createdAt: now, updatedAt: now },
    ];
    const messages: Record<string, any[]> = {
      s1: [{ id: 'm1', role: 'user', content: 'Explain' }, { id: 'm2', role: 'assistant', content: 'Example:\n\n```js\nconst answer = 42; // note\n```' }],
      s2: [{ id: 'n1', role: 'user', content: 'Hi' }],
    };
    (window as any).__calls = [];
    const log = (method: string, ...args: any[]) => (window as any).__calls.push([method, ...args]);
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions,
      listModels: async () => [],
      getMessages: async (id: string) => messages[id] || [],
      createSession: async () => sessions[0], sendMessage: async () => {}, interruptSession: async () => {},
      renameSession: async () => {}, deleteSession: async () => {}, setSessionModel: async () => {}, closeOwnedSession: async () => {},
      copyText: async (text: string) => log('copy', text),
      saveText: async (name: string, content: string) => { log('save', name, content); return true; },
      chooseDirectory: async () => '/tmp/chosen', openDirectory: async (path: string) => log('open', path),
    };
  });
});

test('exports the open conversation as Markdown and copies it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await expect(page.getByText('Example:')).toBeVisible();
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Export as Markdown' }).click();
  await expect(page.getByText('Conversation exported as Markdown.')).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__calls);
  expect(calls[0][0]).toBe('save');
  expect(calls[0][1]).toBe('explore-the-workspace.md');
  expect(calls[0][2]).toContain('## Prime');
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Copy as Markdown' }).click();
  await expect(page.getByText('Conversation copied as Markdown.')).toBeVisible();
});
