import { test, expect, type Page } from './fixtures';

// Failure and recovery paths in the main window. Each test replaces only the calls it is about.
async function setup(page: Page, overrides = '', path = '/') {
  await page.addInitScript(() => {
    const session = (id: string, title: string, extra = {}) => ({ id, title, cwd: '/tmp/project', model: 'test/model', status: 'idle', createdAt: '', updatedAt: '', ...extra });
    (window as any).__sessions = [
      session('owned', 'Owned task', { ownership: 'desktop', writable: true, lifecycle: 'open' }),
      session('shared', 'Shared task'),
    ];
    (window as any).__calls = [];
    const log = (...args: any[]) => (window as any).__calls.push(args);
    (window as any).__log = log;
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp', readOnly: true, canCreateOwned: true }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      listSessions: async () => (window as any).__sessions.map((item: any) => ({ ...item })),
      listModels: async () => [{ id: 'test/model', name: 'Test model' }, { id: 'test/other', name: 'Other model' }],
      getMessages: async () => [{ id: 'm1', role: 'user', content: 'Hello there' }, { id: 'm2', role: 'assistant', content: 'General Kenobi' }],
      sendMessage: async () => {}, interruptSession: async (id: string) => log('interrupt', id), closeOwnedSession: async () => {},
      renameSession: async (id: string, title: string) => log('rename', id, title),
      setSessionModel: async (id: string, model: string) => log('model', id, model),
      chooseDirectory: async () => '/tmp/chosen', openDirectory: async (dir: string) => log('open', dir),
      saveText: async () => true, copyText: async () => {},
      notify: async () => {}, onNotificationClick: () => () => {},
    };
  });
  if (overrides) await page.addInitScript(overrides);
  await page.goto(path);
}
const calls = (page: Page, name: string) => page.evaluate(name => (window as any).__calls.filter((call: any[]) => call[0] === name), name);
const banner = (page: Page) => page.locator('.error-banner');

test('a startup failure is shown instead of an empty, silent window', async ({ page }) => {
  await setup(page, `window.prime.status = async () => { throw new Error('Preload bridge unavailable'); };`);
  await expect(banner(page)).toContainText('Preload bridge unavailable');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await expect(banner(page)).toHaveCount(0);
});

test('reconnect reports each way it can fail, then loads sessions and models once connected', async ({ page }) => {
  await setup(page, `
    const up = { connected: true, version: 'test', home: '/tmp' };
    window.__up = false;
    window.prime.status = async () => window.__up ? up : { connected: false, home: '/tmp', error: 'connect ENOENT /tmp/daemon.sock' };
    const attempts = [
      async () => ({ connected: false, home: '/tmp' }),
      async () => { throw new Error('spawn prime-agent EACCES'); },
      async () => { window.__up = true; window.__listFails = true; return up; },
      async () => { window.__listFails = false; window.__modelsFail = true; return up; },
    ];
    window.prime.connect = async () => attempts.shift()();
    const list = window.prime.listSessions;
    window.prime.listSessions = async () => { if (window.__listFails) throw new Error('catalog unreadable'); return list(); };
    const models = window.prime.listModels;
    window.prime.listModels = async () => { if (window.__modelsFail) throw new Error('models timed out'); return models(); };`);
  await expect(page.getByText('connect ENOENT /tmp/daemon.sock')).toBeVisible();
  const start = page.getByRole('button', { name: 'Start agent service / reconnect' });
  await start.click();
  await expect(banner(page)).toContainText('Could not connect to Prime Agent. Check that the CLI is installed and authenticated.');
  await start.click();
  await expect(banner(page)).toContainText('spawn prime-agent EACCES');
  await start.click();
  await expect(banner(page)).toContainText('catalog unreadable');
  await expect(page.getByRole('button', { name: /Owned task/ })).toHaveCount(0);
  // Connected now, so the explicit reconnect lives in the command palette.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands and sessions' }).fill('reconnect');
  await page.keyboard.press('Enter');
  await expect(banner(page)).toContainText('Model discovery: models timed out');
  await expect(page.getByRole('button', { name: /Owned task/ })).toBeVisible();
});

test('losing the agent while the window is open is shown on the next status poll', async ({ page }) => {
  await setup(page, `
    const status = window.prime.status;
    window.prime.status = async () => { if (window.__down) throw new Error('Prime Agent daemon disconnected.'); return status(); };`);
  await expect(page.getByRole('button', { name: /Owned task/ })).toBeVisible();
  await page.evaluate(() => { (window as any).__down = true; });
  await expect(page.locator('.offline-banner', { hasText: 'Prime Agent daemon disconnected.' })).toBeVisible({ timeout: 10_000 });
});

test('a transcript that cannot be read, or a failed conversation search, never blanks the sidebar', async ({ page }) => {
  await setup(page, `
    window.prime.getMessages = async () => { throw new Error('Saved transcript is corrupt.'); };
    window.prime.searchSessions = async query => { window.__log('search', query); throw new Error('search index missing'); };`);
  await page.getByRole('button', { name: /Shared task/ }).click();
  await expect(banner(page)).toContainText('Saved transcript is corrupt.');
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('Owned');
  await expect.poll(() => calls(page, 'search')).toEqual([['search', 'Owned']]);
  await expect(page.getByRole('button', { name: /Owned task/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Shared task/ })).toHaveCount(0);
});

test('a writable session changes model through the agent, and a refusal is reported', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /Owned task/ }).click();
  const model = page.getByRole('combobox', { name: 'Model' });
  await model.selectOption('test/other');
  await expect.poll(() => calls(page, 'model')).toEqual([['model', 'owned', 'test/other']]);
  await page.evaluate(() => { (window as any).prime.setSessionModel = async () => { throw new Error('Unknown model test/model'); }; });
  await model.selectOption('test/model');
  await expect(banner(page)).toContainText('Unknown model test/model');
  // Shared sessions cannot change model at all.
  await page.getByRole('button', { name: /Shared task/ }).click();
  await expect(model).toBeDisabled();
});

test('export, stop and folder failures are reported', async ({ page }) => {
  await setup(page, `
    window.__sessions[0].status = 'running';
    window.prime.saveText = async () => { throw new Error('disk full'); };
    window.prime.interruptSession = async () => { throw new Error('No active run.'); };
    window.prime.chooseDirectory = async () => { throw new Error('Dialog already open'); };
    window.prime.openDirectory = async () => { throw new Error('Folder was moved'); };`);
  await page.getByRole('button', { name: /Owned task/ }).click();
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Export as Markdown' }).click();
  await expect(banner(page)).toContainText('Export: disk full');
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await expect(banner(page)).toContainText('No active run.');
  await page.locator('.session-context button').click();
  await expect(banner(page)).toContainText('Folder was moved');
  await page.keyboard.press('Control+n');
  await page.locator('.folder-control').click();
  await expect(banner(page)).toContainText('Dialog already open');
});

test('choosing a folder for a new session updates it, and cancelling the picker keeps the old one', async ({ page }) => {
  await setup(page, `
    const answers = ['/tmp/chosen', null];
    window.prime.chooseDirectory = async () => answers.shift();`);
  const folder = page.locator('.folder-control');
  await folder.click();
  await expect(folder).toHaveAttribute('title', '/tmp/chosen');
  await folder.click();
  await expect(folder).toHaveAttribute('title', '/tmp/chosen');
});

test('the command palette offers find, tags, rename, workspace and stop for the open session', async ({ page }) => {
  await setup(page, `window.__sessions[0].status = 'running';`);
  await page.getByRole('button', { name: /Owned task/ }).click();
  const run = async (label: string) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands and sessions' }).fill(label);
    await expect(page.locator('#palette-list [role=option]').first()).toContainText(label);
    await page.keyboard.press('Enter');
  };
  await run('Find in conversation');
  await expect(page.getByRole('textbox', { name: /Find/ })).toBeFocused();
  await page.keyboard.press('Escape');

  await run('Show workspace files and changes');
  await expect(page.getByRole('complementary', { name: 'Workspace' })).toBeVisible();
  await run('Hide workspace files and changes');
  await expect(page.getByRole('complementary', { name: 'Workspace' })).toHaveCount(0);

  await run('Edit tags for this session');
  await expect(page.getByRole('textbox', { name: 'Tags' })).toBeVisible();
  await page.keyboard.press('Escape');

  await run('Rename this session');
  const title = page.getByRole('textbox', { name: 'Session title' });
  await expect(title).toHaveValue('Owned task');
  // Whitespace passes the required check but is never sent as a title.
  await title.fill('   ');
  await title.press('Enter');
  await expect(title).toBeVisible();
  expect(await calls(page, 'rename')).toEqual([]);
  await title.fill('  Renamed task ');
  await title.press('Enter');
  await expect(title).toHaveCount(0);
  expect(await calls(page, 'rename')).toEqual([['rename', 'owned', 'Renamed task']]);

  await run('Stop generation');
  await expect.poll(() => calls(page, 'interrupt')).toEqual([['interrupt', 'owned']]);

  // Read-only shared sessions get none of the write actions.
  await page.getByRole('button', { name: /Shared task/ }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands and sessions' }).fill('Rename this session');
  await expect(page.locator('#palette-list [role=option]', { hasText: 'Rename this session' })).toHaveCount(0);
});

test('a tag filter is cleared when its last tag is removed', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /Shared task/ }).click();
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Edit tags' }).click();
  await page.getByRole('textbox', { name: 'Tags' }).fill('later');
  await page.getByRole('button', { name: 'Save tags' }).click();
  await page.getByRole('button', { name: 'later', exact: true }).click();
  await expect(page.getByRole('button', { name: /Owned task/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Edit tags' }).click();
  await page.getByRole('textbox', { name: 'Tags' }).fill('');
  await page.getByRole('button', { name: 'Save tags' }).click();
  await expect(page.getByRole('button', { name: /Owned task/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'later', exact: true })).toHaveCount(0);
});

test('widening the window closes the narrow sidebar drawer', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await setup(page);
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 760, height: 560 });
  await expect(page.locator('aside')).toHaveAttribute('inert', '');
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
});
