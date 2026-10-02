import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const sessions = [{ id: 's1', title: 'Find session', cwd: '/tmp/find', model: 'test/model', status: 'idle', createdAt: now, updatedAt: now }];
    const messages = [
      ...Array.from({ length: 105 }, (_, i) => ({ id: `old-${i}`, role: i % 2 ? 'assistant' : 'user', content: i === 0 ? 'The needle in the oldest message' : `Filler message ${i}` })),
      { id: 'u1', role: 'user', content: 'Where is the Needle?' },
      { id: 'a1', role: 'assistant', content: 'One needle here and another needle there.' },
      { id: 't1', role: 'tool', toolName: 'grep', content: 'needle found in tool output' },
    ];
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions, listModels: async () => [], getMessages: async () => messages,
      sendMessage: async () => {}, interruptSession: async () => {}, renameSession: async () => {}, deleteSession: async () => {},
      copyText: async () => {}, openDirectory: async () => {}, chooseDirectory: async () => null,
    };
  });
});

const open = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Find session/ }).click();
  await expect(page.getByText('Where is the Needle?')).toBeVisible();
};
const findField = (page: Page) => page.getByRole('textbox', { name: 'Find in conversation' });
const count = (page: Page) => page.locator('.find-count');

// The tool row matches twice: once in its one-line preview and once in its full output.
test('Ctrl/Cmd+F finds case-insensitive matches, steps through them and opens collapsed tool output', async ({ page }) => {
  await open(page);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(findField(page)).toBeFocused();
  await findField(page).fill('needle');
  await expect(count(page)).toHaveText('1 of 5');
  await findField(page).press('Enter');
  await expect(count(page)).toHaveText('2 of 5');
  await findField(page).press('Shift+Enter');
  await findField(page).press('Shift+Enter');
  await expect(count(page)).toHaveText('5 of 5');
  // The match sits in tool output nested inside the collapsed trace; every enclosing section opens.
  await expect(page.locator('pre', { hasText: 'needle found in tool output' })).toBeVisible();
  await findField(page).fill('nothing like this');
  await expect(count(page)).toHaveText('No matches');
});

test('messages hidden behind Load earlier are offered and searched once loaded', async ({ page }) => {
  await open(page);
  await page.keyboard.press('ControlOrMeta+f');
  await findField(page).fill('needle');
  await expect(count(page)).toHaveText('1 of 5');
  await page.getByRole('button', { name: /8 earlier messages not searched/ }).click();
  await expect(count(page)).toHaveText('1 of 6');
  await expect(page.getByRole('button', { name: /not searched/ })).toHaveCount(0);
});

test('Escape closes find and returns focus to the composer', async ({ page }) => {
  await open(page);
  await page.keyboard.press('ControlOrMeta+f');
  await findField(page).press('Escape');
  await expect(findField(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Prime' })).toBeFocused();
});
