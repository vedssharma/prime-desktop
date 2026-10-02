import { test, expect, type Page } from '@playwright/test';

// Pushed events are delivered by the test through window.__emit, the same shape the preload forwards.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const sessions = [
      { id: 'owned', title: 'Owned session', cwd: '/tmp/owned', model: 'test/chosen', status: 'running', createdAt: now, updatedAt: now, ownership: 'desktop', writable: true, lifecycle: 'open' },
      { id: 'other', title: 'Other session', cwd: '/tmp/other', model: 'test/chosen', status: 'idle', createdAt: now, updatedAt: now, ownership: 'desktop', writable: true, lifecycle: 'open' },
    ];
    const messages: Record<string, any[]> = { owned: [{ id: 'user-1', role: 'user', content: 'Explain the change' }], other: [] };
    const calls: string[][] = [];
    let listener: ((event: any) => void) | undefined;
    Object.assign(window as any, { __calls: calls, __sessions: sessions, __messages: messages, __emit: (event: any) => listener?.(event) });
    (window as any).prime = {
      status: async () => ({ connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }),
      listSessions: async () => { calls.push(['list']); return sessions.map(session => ({ ...session })); },
      listModels: async () => [{ id: 'test/chosen', name: 'Chosen model' }],
      getMessages: async (id: string) => { calls.push(['read', id]); return [...(messages[id] || [])]; },
      onSessionEvent: (next: (event: any) => void) => { listener = next; return () => { listener = undefined; }; },
      sendMessage: async () => {}, interruptSession: async () => {}, renameSession: async () => {}, deleteSession: async () => {},
      getSessionUsage: async () => ({ userMessages: 1, assistantMessages: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
      copyText: async () => {}, openDirectory: async () => {}, chooseDirectory: async () => null,
    };
  });
});

const open = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Owned session/ }).click();
  await expect(page.getByText('Explain the change')).toBeVisible();
};
const emit = (page: Page, event: object) => page.evaluate(value => (window as any).__emit(value), event);
const reply = (content: string) => ({ type: 'stream', sessionId: 'owned', streamId: 'assistant-9', messages: [{ id: 'assistant-9', role: 'assistant', content }] });

test('streamed chunks update one reply in place without a transcript read', async ({ page }) => {
  await open(page);
  const reads = await page.evaluate(() => (window as any).__calls.filter((call: string[]) => call[0] === 'read').length);
  await emit(page, reply('First part'));
  await expect(page.getByText('First part')).toBeVisible();
  await emit(page, reply('First part and the rest'));
  await expect(page.getByText('First part and the rest')).toBeVisible();
  await expect(page.locator('article.message.assistant')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__calls.filter((call: string[]) => call[0] === 'read').length)).toBe(reads);
});

test('events for another session never change the open conversation', async ({ page }) => {
  await open(page);
  await emit(page, { ...reply('Not for this view'), sessionId: 'other' });
  await emit(page, reply('Visible reply'));
  await expect(page.getByText('Visible reply')).toBeVisible();
  await expect(page.getByText('Not for this view')).toHaveCount(0);
});

test('a finished message re-reads the transcript and run activity refreshes the session list', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__messages.owned.push({ id: 'assistant-9', role: 'assistant', content: 'Final reply' }); });
  await emit(page, { type: 'changed', sessionId: 'owned' });
  await expect(page.getByText('Final reply')).toBeVisible();
  await page.evaluate(() => { (window as any).__sessions[0].status = 'idle'; });
  await emit(page, { type: 'activity', sessionId: 'owned' });
  await expect(page.getByText('Prime is working')).toHaveCount(0, { timeout: 1000 });
});
