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
      notify: async (title: string, body: string, id: string) => log('notify', title, body, id),
      onNotificationClick: (listener: (id: string) => void) => { (window as any).__click = listener; return () => {}; },
      workspaceChanges: async (_id: string) => ({ isRepo: true, truncated: false, changes: [{ path: 'src/a.ts', status: 'M', label: 'Modified' }, { path: 'new.txt', status: '??', label: 'Untracked' }] }),
      workspaceDiff: async (id: string, path: string) => { log('diff', id, path); return { path, truncated: false, diff: 'diff --git a/x b/x\n@@ -1 +1 @@\n-old line\n+new line\n' }; },
      workspaceList: async (id: string, path?: string) => path === 'src'
        ? { path, truncated: false, entries: [{ name: 'a.ts', type: 'file', size: 20 }] }
        : { path: '', truncated: false, entries: [{ name: 'src', type: 'dir', size: 0 }, { name: 'logo.png', type: 'file', size: 9 }, { name: 'link', type: 'link', size: 0 }] },
      workspaceRead: async (id: string, path: string) => path === 'logo.png'
        ? { path, size: 9, binary: true, truncated: false, content: '' }
        : { path, size: 20, binary: false, truncated: false, content: 'export const a = 1;\n' },
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

test('highlights fenced code without changing its copied text and previews tool output', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  const block = page.locator('.code-block code');
  await expect(block.locator('.tok-keyword')).toHaveText('const');
  await expect(block.locator('.tok-number')).toHaveText('42');
  await expect(block.locator('.tok-comment')).toHaveText('// note');
  await expect(block).toHaveText('const answer = 42; // note\n');
});

test('notifies once when a running session finishes and opens it from the notification', async ({ page }) => {
  await page.addInitScript(() => {
    const api = (window as any).prime;
    let polls = 0;
    api.listSessions = async () => {
      polls++;
      return [{ id: 's2', title: 'Second task', cwd: '/tmp/other', model: '', status: polls < 2 ? 'running' : 'idle', createdAt: '', updatedAt: '' }];
    };
  });
  await page.goto('/');
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).filter((c: any[]) => c[0] === 'notify').length, { timeout: 15000 }).toBe(1);
  const call = (await page.evaluate(() => (window as any).__calls)).find((c: any[]) => c[0] === 'notify');
  expect(call).toEqual(['notify', 'Session finished', 'Second task', 's2']);
  await page.evaluate(() => (window as any).__click('s2'));
  await expect(page.locator('.breadcrumb strong')).toHaveText('Second task');
});

test('the notification preference can be turned off in settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const box = page.getByLabel(/Notify me when a session finishes/);
  await expect(box).toBeChecked();
  await box.uncheck();
  expect(await page.evaluate(() => localStorage.getItem('session-dock.notifications.v1'))).toBe('off');
});

test('pins, tags, filters and regroups sessions locally', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Second task/ }).click();
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Pin session' }).click();
  await expect(page.locator('.session-group h2').first()).toHaveText('Pinned');
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Edit tags' }).click();
  await page.getByRole('textbox', { name: 'Tags' }).fill('urgent, Bug');
  await page.getByRole('button', { name: 'Save tags' }).click();
  await expect(page.getByRole('button', { name: /Second task/ })).toContainText('urgent, Bug');
  await page.getByRole('button', { name: 'urgent', exact: true }).click();
  await expect(page.getByRole('button', { name: /Explore the workspace/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'urgent', exact: true }).click();
  await expect(page.getByRole('button', { name: /Explore the workspace/ })).toBeVisible();
  await page.getByLabel('Group sessions by').selectOption('workspace');
  await expect(page.locator('.session-group h2')).toHaveText(['Pinned', 'project']);
  await page.reload();
  await expect(page.locator('.session-group h2').first()).toHaveText('Pinned');
});

test('command palette opens with the keyboard, filters, and runs actions and session jumps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Search commands and sessions' });
  await expect(input).toBeFocused();
  await input.fill('second');
  await expect(page.locator('#palette-list [role=option]').first()).toContainText('Go to: Second task');
  await page.keyboard.press('Enter');
  await expect(page.locator('.breadcrumb strong')).toHaveText('Second task');
  await page.keyboard.press('Control+k');
  await input.fill('pin');
  await page.keyboard.press('Enter');
  await expect(page.locator('.session-group h2').first()).toHaveText('Pinned');
  await page.keyboard.press('Control+k');
  await input.fill('settings');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /appearance/i }).first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(input).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('workspace panel shows git changes with a diff and a read-only file tree', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await page.getByRole('button', { name: 'Workspace files and changes' }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace' });
  await expect(panel.getByRole('tab', { name: /Changes \(2\)/ })).toBeVisible();
  await panel.getByRole('button', { name: /src\/a\.ts/ }).click();
  await expect(panel.locator('.diff-line.add')).toHaveText('+new line');
  await expect(panel.locator('.diff-line.del')).toHaveText('-old line');
  await panel.getByRole('tab', { name: 'Files' }).click();
  await expect(panel.getByRole('button', { name: /link/ })).toBeDisabled();
  await panel.getByRole('button', { name: /logo\.png/ }).click();
  await expect(panel.getByText('Binary file')).toBeVisible();
  await panel.getByRole('button', { name: 'src', exact: true }).click();
  await panel.getByRole('button', { name: /a\.ts/ }).click();
  await expect(panel.locator('.file-view .tok-keyword')).toHaveText(['export', 'const']);
  await panel.getByRole('button', { name: 'Close workspace panel' }).click();
  await expect(panel).toHaveCount(0);
});

test('shows the agent-reported queue count for desktop sessions', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).prime.listSessions = async () => [{ id: 's1', title: 'Owned', cwd: '/tmp/project', model: '', status: 'running', createdAt: '', updatedAt: '', ownership: 'desktop', writable: true, lifecycle: 'open', queuedCount: 2 }];
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Owned/ }).click();
  await expect(page.locator('.header-running')).toContainText('2 queued');
  await page.getByText('Work & queue status', { exact: true }).click();
  await expect(page.getByText(/2 queued follow-ups/)).toBeVisible();
});

test('edits a file in a desktop-owned session, and surfaces a disk conflict without losing the draft', async ({ page }) => {
  await page.addInitScript(() => {
    const api = (window as any).prime;
    api.listSessions = async () => [{ id: 's1', title: 'Owned', cwd: '/tmp/project', model: '', status: 'idle', createdAt: '', updatedAt: '', ownership: 'desktop', writable: true, lifecycle: 'open' }];
    api.workspaceRead = async (id: string, path: string) => ({ path, size: 6, binary: false, truncated: false, editable: true, hash: 'a'.repeat(64), content: 'line1\n' });
    let attempts = 0;
    api.workspaceSave = async (id: string, path: string, content: string, hash: string) => {
      (window as any).__calls.push(['save-file', path, content, hash]);
      if (++attempts === 1) throw new Error("Error invoking remote method 'prime:workspaceSave': Error: CHANGED_ON_DISK: This file changed on disk after you opened it. Reload it to see the new contents; your edit was not saved.");
      return { file: { path, size: 8, binary: false, truncated: false, editable: true, hash: 'b'.repeat(64), content }, backup: '/backups/x' };
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Owned/ }).click();
  await page.getByRole('button', { name: 'Workspace files and changes' }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace' });
  await panel.getByRole('tab', { name: 'Files' }).click();
  await panel.getByRole('button', { name: /logo\.png/ }).click();
  await panel.getByRole('button', { name: 'src', exact: true }).click();
  await panel.getByRole('button', { name: /a\.ts/ }).click();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Edit file' }).fill('line1\nline2\n');
  await expect(panel.getByText('unsaved changes')).toBeVisible();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('changed on disk after you opened it');
  await expect(panel.getByRole('textbox', { name: 'Edit file' })).toHaveValue('line1\nline2\n');
  await expect(panel.getByRole('button', { name: 'Reload from disk' })).toBeVisible();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('backed up to /backups/x');
  const saves = (await page.evaluate(() => (window as any).__calls)).filter((c: any[]) => c[0] === 'save-file');
  expect(saves[1][2]).toBe('line1\nline2\n');
  expect(saves[1][3]).toBe('a'.repeat(64));
});

test('shared sessions offer no editing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await page.getByRole('button', { name: 'Workspace files and changes' }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace' });
  await panel.getByRole('tab', { name: 'Files' }).click();
  await panel.getByRole('button', { name: 'src', exact: true }).click();
  await panel.getByRole('button', { name: /a\.ts/ }).click();
  await expect(panel.getByText('Editing is available only in desktop-owned sessions.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});
