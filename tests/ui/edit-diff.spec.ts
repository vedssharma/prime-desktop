import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const calls: string[][] = [];
    (window as any).__calls = calls;
    const sessions = [{ id: 's1', title: 'Edit session', cwd: '/tmp/edit', model: 'test/model', status: 'idle', createdAt: now, updatedAt: now }];
    const messages = [
      { id: 'u1', role: 'user', content: 'Fix the greeting' },
      { id: 'c1', role: 'tool', toolName: 'edit', content: JSON.stringify({ path: 'src/greet.ts', edits: [{ oldText: "return 'helo';", newText: "return 'hello';" }] }, null, 2) },
      { id: 'r1', role: 'tool', toolName: 'edit', content: 'Successfully replaced 1 block in src/greet.ts.', diff: "  1 export function greet() {\n- 2   return 'helo';\n+ 2   return 'hello';\n  3 }" },
      { id: 'b1', role: 'tool', toolName: 'bash', content: '$ npm test\nok' },
      { id: 'a1', role: 'assistant', content: 'Fixed the typo.' },
    ];
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions, listModels: async () => [], getMessages: async () => messages,
      sendMessage: async () => {}, interruptSession: async () => {}, renameSession: async () => {}, deleteSession: async () => {},
      copyText: async () => {}, openDirectory: async () => {}, chooseDirectory: async () => null,
      workspaceChanges: async () => ({ isRepo: true, truncated: false, changes: [{ path: 'src/greet.ts', status: 'M', label: 'Modified' }] }),
      workspaceDiff: async (id: string, path: string) => { calls.push(['diff', id, path]); return { path, truncated: false, diff: "@@ -2 +2 @@\n-  return 'helo';\n+  return 'hello';\n" }; },
      workspaceList: async () => ({ entries: [], truncated: false }),
    };
  });
});

test('edit tool calls and results render as diffs with a raw view and a link to Changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Edit session/ }).click();
  await expect(page.getByText('Fixed the typo.')).toBeVisible();
  await page.getByText('Thought process').click();

  const proposed = page.locator('details.edit-message', { hasText: 'src/greet.ts' });
  await proposed.locator('summary').click();
  await expect(proposed.getByLabel('Proposed changes')).toContainText("return 'hello';");
  await expect(proposed.locator('.diff-counts')).toHaveText('+1 -1');
  await proposed.getByRole('button', { name: 'Show raw' }).click();
  await expect(proposed.locator('pre')).toContainText('"oldText"');
  await proposed.getByRole('button', { name: 'Show diff' }).click();

  const applied = page.locator('details.edit-message', { hasText: 'Applied changes' });
  await applied.locator('summary').click();
  await expect(applied.getByLabel('Applied changes').locator('.diff-line.add')).toContainText("return 'hello';");
  await expect(applied.getByLabel('Applied changes').locator('.diff-number').first()).toHaveText('1');

  // Other tools keep the plain output view.
  await expect(page.locator('details.tool-message:not(.edit-message)', { hasText: 'bash' })).toHaveCount(1);

  await proposed.getByRole('button', { name: 'Show in Changes' }).click();
  await expect(page.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary').or(page.locator('.workspace-slot')).getByLabel('Diff')).toContainText("+  return 'hello';");
  expect(await page.evaluate(() => (window as any).__calls)).toContainEqual(['diff', 's1', 'src/greet.ts']);
});
