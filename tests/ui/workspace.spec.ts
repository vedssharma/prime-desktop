import { test, expect, type Page } from './fixtures';

// Each test overrides only the workspace calls it is about; the rest of the API is a quiet stub.
async function setup(page: Page, overrides: string, options: { owned?: boolean; running?: boolean } = {}) {
  await page.addInitScript(({ owned, running }) => {
    const session = { id: 's1', title: 'Workspace task', cwd: '/tmp/project', model: 'test/model', status: running ? 'running' : 'idle', createdAt: '', updatedAt: '',
      ...(owned ? { ownership: 'desktop', writable: true, lifecycle: 'open' } : {}) };
    (window as any).__session = session;
    (window as any).__calls = [];
    const log = (...args: any[]) => (window as any).__calls.push(args);
    (window as any).__log = log;
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      listSessions: async () => [{ ...session }],
      listModels: async () => [],
      getMessages: async () => [{ id: 'm1', role: 'user', content: 'Look around' }],
      sendMessage: async () => {}, interruptSession: async () => {}, closeOwnedSession: async () => {},
      notify: async () => {}, onNotificationClick: () => () => {},
      workspaceChanges: async () => { log('changes'); return { isRepo: true, truncated: false, changes: [] }; },
      workspaceDiff: async (_id: string, path: string) => ({ path, truncated: false, diff: '' }),
      workspaceList: async () => ({ path: '', truncated: false, entries: [] }),
      workspaceRead: async (_id: string, path: string) => ({ path, size: 6, binary: false, truncated: false, content: 'hello\n' }),
    };
  }, { owned: !!options.owned, running: !!options.running });
  if (overrides) await page.addInitScript(overrides);
  await page.goto('/');
  await page.getByRole('button', { name: /Workspace task/ }).click();
  await page.getByRole('button', { name: 'Workspace files and changes' }).click();
  return page.getByRole('complementary', { name: 'Workspace' });
}

test('a folder that is not a repository, or a missing git, explains why there is no change list', async ({ page }) => {
  const panel = await setup(page, `
    window.prime.workspaceChanges = async () => ({ isRepo: false, truncated: false, changes: [], ...(window.__noGit ? { error: 'Git is not installed or not on PATH.' } : {}) });`);
  await expect(panel.getByText('This workspace is not a Git repository, so there is no change list.')).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Changes', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__noGit = true; });
  await panel.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(panel.getByText('Git is not installed or not on PATH.')).toBeVisible();
});

test('change list, diff and listing failures are shown as alerts, and refresh recovers', async ({ page }) => {
  const panel = await setup(page, `
    let fail = true;
    window.__recover = () => { fail = false; };
    window.prime.workspaceChanges = async () => { if (fail) throw new Error('git status timed out'); return { isRepo: true, truncated: false, changes: [{ path: 'a.txt', status: 'M', label: 'Modified' }] }; };
    window.prime.workspaceDiff = async () => { throw new Error('diff exploded'); };
    window.prime.workspaceList = async () => { if (fail) throw new Error('Permission denied'); return { path: '', truncated: false, entries: [{ name: 'a.txt', type: 'file', size: 4 }] }; };`);
  await expect(panel.getByRole('alert')).toHaveText('git status timed out');
  await page.evaluate(() => (window as any).__recover());
  await panel.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(panel.getByRole('tab', { name: 'Changes (1)' })).toBeVisible();
  await panel.getByRole('button', { name: /a\.txt/ }).click();
  await expect(panel.getByRole('alert')).toHaveText('diff exploded');

  await page.evaluate(() => { (window as any).prime.workspaceList = async () => { throw new Error('Permission denied'); }; });
  await panel.getByRole('tab', { name: 'Files' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Permission denied');
  await page.evaluate(() => { (window as any).prime.workspaceList = async () => ({ path: '', truncated: false, entries: [{ name: 'a.txt', type: 'file', size: 4 }] }); });
  // Refreshing on the Files tab reloads the tree as well as the changes.
  await panel.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(panel.getByRole('button', { name: /a\.txt/ })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('long change lists, empty diffs and truncated diffs say so', async ({ page }) => {
  const panel = await setup(page, `
    window.prime.workspaceChanges = async () => ({ isRepo: true, truncated: true, changes: [{ path: 'mode-only.sh', status: 'M', label: 'Modified' }, { path: 'huge.log', status: 'M', label: 'Modified' }] });
    window.prime.workspaceDiff = async (_id, path) => path === 'huge.log'
      ? { path, truncated: true, diff: 'diff --git a/huge.log b/huge.log\\nindex 1..2\\n--- a/huge.log\\n+++ b/huge.log\\n@@ -1 +1 @@\\n-a\\n+b\\n context' }
      : { path, truncated: false, diff: '' };`);
  await expect(panel.getByRole('tab', { name: 'Changes (2+)' })).toBeVisible();
  await expect(panel.getByText('Only the first 2 changes are listed.')).toBeVisible();
  await panel.getByRole('button', { name: /mode-only\.sh/ }).click();
  await expect(panel.getByText('No textual diff for mode-only.sh.')).toBeVisible();
  await panel.getByRole('button', { name: /huge\.log/ }).click();
  await expect(panel.getByText('Diff truncated.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /huge\.log/ })).toHaveClass(/selected/);
  await expect(panel.locator('.diff-line.meta')).toHaveCount(4);
  await expect(panel.locator('.diff-line.hunk')).toHaveText('@@ -1 +1 @@');
  await expect(panel.locator('.diff-line').last()).toHaveText(' context');
});

test('the file tree expands and collapses folders, reports nested errors and limits, and labels sizes', async ({ page }) => {
  const panel = await setup(page, `
    window.prime.workspaceList = async (_id, path) => {
      window.__log('list', path);
      if (path === '') return { path, truncated: true, entries: [{ name: 'src', type: 'dir', size: 0 }, { name: 'locked', type: 'dir', size: 0 }, { name: 'big.bin', type: 'file', size: 3 * 1024 * 1024 }, { name: 'notes.txt', type: 'file', size: 2048 }] };
      if (path === 'locked') throw new Error('EACCES: permission denied');
      if (path === 'src') return { path, truncated: true, entries: [{ name: 'lib', type: 'dir', size: 0 }, { name: 'alias', type: 'link', size: 0 }, { name: 'index.ts', type: 'file', size: 12 }] };
      return { path, truncated: false, entries: [{ name: 'deep.ts', type: 'file', size: 1 }] };
    };`);
  await panel.getByRole('tab', { name: 'Files' }).click();
  await expect(panel.getByRole('button', { name: /big\.bin/ })).toContainText('3.0 MB');
  await expect(panel.getByRole('button', { name: /notes\.txt/ })).toContainText('2.0 KB');
  await expect(panel.getByText('Only the first entries are shown.')).toHaveCount(1);

  await panel.getByRole('button', { name: 'locked', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('EACCES: permission denied');

  const src = panel.getByRole('button', { name: 'src', exact: true });
  await src.click();
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('button', { name: /alias/ })).toBeDisabled();
  await expect(panel.getByRole('button', { name: /alias/ })).toHaveAttribute('title', 'Symbolic links are not followed');
  await expect(panel.getByRole('button', { name: /index\.ts/ })).toContainText('12 B');
  await expect(panel.getByText('Only the first entries are shown.')).toHaveCount(2);
  await panel.getByRole('button', { name: 'lib', exact: true }).click();
  await expect(panel.getByRole('button', { name: /deep\.ts/ })).toBeVisible();
  await panel.getByRole('button', { name: /deep\.ts/ }).click();
  await expect(panel.getByRole('button', { name: /deep\.ts/ })).toHaveClass(/selected/);

  await src.click();
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('button', { name: /index\.ts/ })).toHaveCount(0);
  const lists = (await page.evaluate(() => (window as any).__calls)).filter((call: any[]) => call[0] === 'list').map((call: any[]) => call[1]);
  expect(lists).toEqual(['', 'locked', 'src', 'src/lib']);
});

test('file previews explain unreadable, oversized and non-UTF-8 files', async ({ page }) => {
  const panel = await setup(page, `
    window.prime.workspaceList = async () => ({ path: '', truncated: false, entries: ['gone.txt', 'big.txt', 'latin1.txt', 'plain'].map(name => ({ name, type: 'file', size: 10 })) });
    window.prime.workspaceRead = async (_id, path) => {
      if (path === 'gone.txt') throw new Error('ENOENT: no such file');
      if (path === 'big.txt') return { path, size: 5 * 1024 * 1024, binary: false, truncated: true, editable: false, content: 'x'.repeat(2048) };
      if (path === 'latin1.txt') return { path, size: 3, binary: false, truncated: false, editable: false, content: 'caf?' };
      return { path, size: 5, binary: false, truncated: false, editable: true, hash: 'h', content: 'plain' };
    };`, { owned: true });
  await panel.getByRole('tab', { name: 'Files' }).click();
  await panel.getByRole('button', { name: /gone\.txt/ }).click();
  await expect(panel.getByRole('alert')).toHaveText('ENOENT: no such file');
  await panel.getByRole('button', { name: /big\.txt/ }).click();
  await expect(panel.getByText('Too large to edit here.')).toBeVisible();
  await expect(panel.getByText('Preview truncated to the first 2.0 KB.')).toBeVisible();
  await expect(panel.getByText('big.txt · 5.0 MB')).toBeVisible();
  await panel.getByRole('button', { name: /latin1\.txt/ }).click();
  await expect(panel.getByText('Not valid UTF-8 text, so it cannot be edited here.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  // A file with no known language is shown as plain text.
  await panel.getByRole('button', { name: /plain/ }).click();
  await expect(panel.getByLabel('File contents')).toHaveText('plain');
  await expect(panel.locator('.file-view [class^="tok-"]')).toHaveCount(0);
});

test('unsaved edits ask before they are discarded by Cancel, the Changes tab or opening another file', async ({ page }) => {
  const panel = await setup(page, `
    window.prime.workspaceList = async () => ({ path: '', truncated: false, entries: [{ name: 'a.txt', type: 'file', size: 6 }, { name: 'b.txt', type: 'file', size: 6 }] });
    window.prime.workspaceRead = async (_id, path) => ({ path, size: 6, binary: false, truncated: false, editable: true, hash: 'h', content: path + '\\n' });`, { owned: true });
  const answers: boolean[] = [];
  page.on('dialog', dialog => { expect(dialog.message()).toBe('Discard your unsaved edits?'); void (answers.shift() ? dialog.accept() : dialog.dismiss()); });
  await panel.getByRole('tab', { name: 'Files' }).click();
  await panel.getByRole('button', { name: /a\.txt/ }).click();
  const editor = panel.getByRole('textbox', { name: 'Edit file' });

  // Cancel without edits never asks.
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveCount(0);

  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.fill('changed');
  answers.push(false);
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveValue('changed');
  answers.push(false);
  await panel.getByRole('tab', { name: /Changes/ }).click();
  await expect(panel.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  answers.push(false);
  await panel.getByRole('button', { name: /b\.txt/ }).click();
  await expect(panel.getByText('a.txt · 6 B · unsaved changes')).toBeVisible();

  answers.push(true);
  await panel.getByRole('button', { name: /b\.txt/ }).click();
  await expect(panel.getByLabel('File contents')).toHaveText('b.txt\n');
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.fill('other');
  answers.push(true);
  await panel.getByRole('tab', { name: /Changes/ }).click();
  await expect(panel.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true');
  expect(answers).toEqual([]);
});

test('a conflicting save can be reloaded from disk, and other save errors keep the draft', async ({ page }) => {
  const panel = await setup(page, `
    let disk = 'original\\r\\n';
    window.prime.workspaceList = async () => ({ path: '', truncated: false, entries: [{ name: 'a.txt', type: 'file', size: 10 }] });
    window.prime.workspaceRead = async (_id, path) => ({ path, size: disk.length, binary: false, truncated: false, editable: true, hash: 'h-' + disk.length, content: disk });
    let saves = 0;
    window.prime.workspaceSave = async (_id, path, content, hash) => {
      window.__log('save', content, hash);
      if (++saves === 1) { disk = 'someone else\\r\\n'; throw new Error("Error invoking remote method 'prime:workspaceSave': Error: CHANGED_ON_DISK: This file changed on disk after you opened it."); }
      throw new Error('ENOSPC: no space left on device');
    };`, { owned: true });
  await panel.getByRole('tab', { name: 'Files' }).click();
  await panel.getByRole('button', { name: /a\.txt/ }).click();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = panel.getByRole('textbox', { name: 'Edit file' });
  await expect(editor).toHaveValue('original\n');
  await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await editor.fill('mine\n');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('This file changed on disk after you opened it.');

  const changesBefore = (await page.evaluate(() => (window as any).__calls)).filter((call: any[]) => call[0] === 'changes').length;
  await panel.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(panel.getByRole('status')).toHaveText('Reloaded from disk.');
  await expect(panel.getByLabel('File contents')).toHaveText('someone else\r\n');
  await expect(panel.getByRole('button', { name: 'Reload from disk' })).toHaveCount(0);
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).filter((call: any[]) => call[0] === 'changes').length).toBeGreaterThan(changesBefore);

  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.fill('second try\n');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('ENOSPC: no space left on device');
  await expect(panel.getByRole('button', { name: 'Reload from disk' })).toHaveCount(0);
  await expect(editor).toHaveValue('second try\n');
  // CRLF files are saved with CRLF line endings even though the editor shows LF.
  const saves = (await page.evaluate(() => (window as any).__calls)).filter((call: any[]) => call[0] === 'save');
  expect(saves).toEqual([['save', 'mine\r\n', 'h-10'], ['save', 'second try\r\n', 'h-14']]);
});

test('a failed reload after a conflict is reported', async ({ page }) => {
  const panel = await setup(page, `
    let reads = 0;
    window.prime.workspaceList = async () => ({ path: '', truncated: false, entries: [{ name: 'a.txt', type: 'file', size: 6 }] });
    window.prime.workspaceRead = async (_id, path) => { if (++reads > 1) throw new Error('EACCES: permission denied'); return { path, size: 6, binary: false, truncated: false, editable: true, hash: 'h', content: 'hello\\n' }; };
    window.prime.workspaceSave = async () => { throw new Error('CHANGED_ON_DISK: Changed.'); };`, { owned: true });
  await panel.getByRole('tab', { name: 'Files' }).click();
  await panel.getByRole('button', { name: /a\.txt/ }).click();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Edit file' }).fill('bye\n');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Changed.');
  await panel.getByRole('button', { name: 'Reload from disk' }).click();
  await expect(panel.getByRole('alert')).toHaveText('EACCES: permission denied');
  await expect(panel.getByRole('textbox', { name: 'Edit file' })).toHaveValue('bye\n');
});

test('changes reload when a running session finishes', async ({ page }) => {
  const panel = await setup(page, `
    window.prime.workspaceChanges = async () => ({ isRepo: true, truncated: false, changes: window.__session.status === 'idle' ? [{ path: 'made-by-agent.txt', status: '??', label: 'Untracked' }] : [] });`, { running: true });
  await expect(panel.getByText('No uncommitted changes.')).toBeVisible();
  // Nothing but the end of the run asks for the changes again.
  await page.evaluate(() => { (window as any).__session.status = 'idle'; });
  await expect(panel.getByRole('button', { name: /made-by-agent\.txt/ })).toBeVisible({ timeout: 10_000 });
});
