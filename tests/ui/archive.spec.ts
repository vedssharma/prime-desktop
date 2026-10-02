import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    let sessions: any[] = [
      { id: 'closed', title: 'Closed history', cwd: '/tmp/closed', model: 'test/chosen', status: 'idle', createdAt: now, updatedAt: now, ownership: 'desktop', writable: false, lifecycle: 'closed' },
      { id: 'open', title: 'Open owned', cwd: '/tmp/open', model: 'test/chosen', status: 'idle', createdAt: now, updatedAt: now, ownership: 'desktop', writable: true, lifecycle: 'open' },
      { id: 'shared', title: 'Shared CLI', cwd: '/tmp/shared', model: '', status: 'idle', createdAt: now, updatedAt: now, ownership: 'shared', writable: false },
    ];
    const calls: any[][] = [];
    (window as any).__calls = calls;
    (window as any).prime = {
      status: async () => ({ connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, readOnly: true, canCreateOwned: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions.map(session => ({ ...session })),
      listModels: async () => [],
      getMessages: async () => [{ id: 'u', role: 'user', content: 'Saved message' }],
      setSessionArchived: async (id: string, archived: boolean) => {
        calls.push(['archive', id, archived]);
        sessions = sessions.map(session => session.id === id ? { ...session, archived: archived || undefined } : session);
      },
      deleteSession: async (id: string) => { calls.push(['delete', id]); sessions = sessions.filter(session => session.id !== id); },
      sendMessage: async () => {}, interruptSession: async () => {}, renameSession: async () => {},
      copyText: async () => {}, openDirectory: async () => {}, chooseDirectory: async () => null,
    };
  });
});

const sidebarItem = (page: Page, name: string) => page.locator('.session-item').filter({ hasText: name });
const menu = (page: Page) => page.getByRole('button', { name: 'Session actions', exact: true });

test('archiving a closed desktop session hides it until archived sessions are shown, and unarchive restores it', async ({ page }) => {
  await page.goto('/');
  await sidebarItem(page, 'Closed history').click();
  await menu(page).click();
  await page.getByRole('button', { name: 'Archive session' }).click();
  await expect(sidebarItem(page, 'Closed history')).toHaveCount(0);
  await expect(page.getByText(/Archived: hidden from the sidebar/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Show archived (1)' }).check();
  await expect(sidebarItem(page, 'Closed history')).toHaveCount(1);
  await menu(page).click();
  await page.getByRole('button', { name: 'Unarchive session' }).click();
  await expect(page.getByRole('checkbox', { name: /Show archived/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive session' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['archive', 'closed', true], ['archive', 'closed', false]]);
});

test('closed desktop history can be deleted after confirmation; open and shared sessions cannot', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Open owned', 'Shared CLI']) {
    await sidebarItem(page, name).click();
    await menu(page).click();
    await expect(page.getByRole('button', { name: 'Delete session' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Archive session' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close session actions' }).click();
  }
  await sidebarItem(page, 'Closed history').click();
  await menu(page).click();
  await page.getByRole('button', { name: 'Delete session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('moved to the trash');
  await expect(dialog).toContainText('Files in its workspace are not changed');
  await dialog.getByRole('button', { name: 'Delete session' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sidebarItem(page, 'Closed history')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Prime' })).toHaveAttribute('placeholder', 'What would you like to work on?');
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['delete', 'closed']]);
});
