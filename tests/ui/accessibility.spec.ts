import { test, expect, type Page } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

// Automated checks catch a subset of problems (names, roles, ARIA misuse, contrast); they
// complement the keyboard and focus tests elsewhere in this suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const sessions = [
      { id: 'closed', title: 'Saved desktop', cwd: '/tmp/a11y', model: 'test/model', status: 'idle', createdAt: now, updatedAt: now, ownership: 'desktop', writable: false, lifecycle: 'closed' },
      { id: 'shared', title: 'Shared CLI', cwd: '/tmp/a11y', model: 'test/model', status: 'idle', createdAt: now, updatedAt: now, ownership: 'shared', writable: false },
    ];
    const messages = [
      { id: 'u1', role: 'user', content: 'Fix the greeting' },
      { id: 'a0', role: 'assistant', content: 'Looking at it.' },
      { id: 'c1', role: 'tool', toolName: 'edit', content: JSON.stringify({ path: 'src/greet.ts', edits: [{ oldText: "return 'helo';", newText: "return 'hello';" }] }) },
      { id: 'r1', role: 'tool', toolName: 'edit', content: 'Edited src/greet.ts', diff: "- 2   return 'helo';\n+ 2   return 'hello';" },
      { id: 'a1', role: 'assistant', content: 'Fixed the **typo**.\n\n```ts\n// greeting\nexport const x = "hi" + 1;\n```' },
    ];
    (window as any).prime = {
      status: async () => ({ connected: true, canCreateOwned: true, readOnly: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, canCreateOwned: true, readOnly: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions, listModels: async () => [], getMessages: async () => messages,
      sendMessage: async () => {}, interruptSession: async () => {}, renameSession: async () => {}, deleteSession: async () => {},
      copyText: async () => {}, openDirectory: async () => {}, chooseDirectory: async () => null,
      workspaceChanges: async () => ({ isRepo: true, truncated: false, changes: [{ path: 'src/greet.ts', status: 'M', label: 'Modified' }] }),
      workspaceDiff: async (_id: string, path: string) => ({ path, truncated: false, diff: "@@ -2 +2 @@\n-  return 'helo';\n+  return 'hello';\n" }),
      workspaceList: async () => ({ entries: [{ name: 'src', type: 'dir' }], truncated: false }),
      resumeOwnedSession: async () => sessions[0], forkOwnedSession: async () => sessions[0],
    };
  });
});

async function expectNoSeriousViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const serious = violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(serious.map(violation => `${violation.id}: ${violation.help} (${violation.nodes.map(node => node.target.join(' ')).join(', ')})`)).toEqual([]);
}

async function openSession(page: Page, title: string) {
  await page.goto('/');
  await page.locator('.session-item').filter({ hasText: title }).click();
  await expect(page.getByText('Fixed the')).toBeVisible();
}

test('welcome view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message Prime' })).toBeVisible();
  await expectNoSeriousViolations(page);
});

for (const colorScheme of ['light', 'dark'] as const) test(`conversation with expanded tool steps and the workspace panel (${colorScheme})`, async ({ page }) => {
  await page.emulateMedia({ colorScheme });
  await openSession(page, 'Shared CLI');
  await page.getByText('Thought process').click();
  for (const summary of await page.locator('details.tool-message summary').all()) await summary.click();
  await page.getByRole('button', { name: 'Workspace files and changes' }).click();
  await page.getByRole('button', { name: /src\/greet\.ts/ }).click();
  await expect(page.getByLabel('Diff')).toBeVisible();
  await expectNoSeriousViolations(page);
});

test('find bar', async ({ page }) => {
  await openSession(page, 'Shared CLI');
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('textbox', { name: 'Find in conversation' }).fill('greet');
  await expectNoSeriousViolations(page);
});

test('settings dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Settings/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoSeriousViolations(page, '[role="dialog"]');
});

test('command palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message Prime' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoSeriousViolations(page, '[role="dialog"]');
});

test('fork dialog', async ({ page }) => {
  await openSession(page, 'Saved desktop');
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await page.getByRole('button', { name: 'Fork saved session', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoSeriousViolations(page, '[role="dialog"]');
});
