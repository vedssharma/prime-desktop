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
      getMessages: async (id: string) => messages[id] || [],
      createSession: async () => { throw Error('not used'); },
      setSessionModel: async (id: string, model: string) => { (window as any).__calls.push(['model', id, model]); },
      closeOwnedSession: async () => { throw Error('Owned process did not exit'); },
      sendMessage: async () => {},
      interruptSession: async () => {},
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
