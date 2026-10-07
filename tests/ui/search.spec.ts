import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const sessions = [
      { id: 'a', title: 'Refactor the parser', cwd: '/tmp/a', model: '', status: 'idle', createdAt: now, updatedAt: now },
      { id: 'b', title: 'Write release notes', cwd: '/tmp/b', model: '', status: 'idle', createdAt: now, updatedAt: now },
    ];
    const queries: string[] = [];
    (window as any).__queries = queries;
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions, listModels: async () => [], getMessages: async () => [],
      searchSessions: async (query: string) => {
        queries.push(query);
        return query.toLowerCase().includes('flaky') ? [{ id: 'b', snippet: '…we fixed the flaky retry loop…' }] : [];
      },
      copyText: async () => {}, openDirectory: async () => {}, chooseDirectory: async () => null,
    };
  });
});

test('sidebar search also finds sessions by conversation text and shows an excerpt', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Search sessions' });
  await search.fill('flaky retry');
  const item = page.locator('.session-item').filter({ hasText: 'Write release notes' });
  await expect(item).toBeVisible();
  await expect(item.locator('.search-snippet')).toHaveText('…we fixed the flaky retry loop…');
  await expect(page.locator('.session-item').filter({ hasText: 'Refactor the parser' })).toHaveCount(0);
  // Typing is debounced into one request for the final text.
  expect(await page.evaluate(() => (window as any).__queries)).toEqual(['flaky retry']);
  await search.fill('parser');
  await expect(page.locator('.session-item').filter({ hasText: 'Refactor the parser' })).toBeVisible();
  await expect(page.locator('.search-snippet')).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('.session-item')).toHaveCount(2);
});
