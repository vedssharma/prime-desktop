import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    let sessions = [{ id: 'test-1', title: 'Explore the workspace', cwd: '/tmp/project', model: 'test/model', status: 'idle', createdAt: now, updatedAt: now }];
    const messages: Record<string, any[]> = { 'test-1': [{ id: 'm1', role: 'user', content: 'Explain this project' }, { id: 'm2', role: 'assistant', content: '## Project overview\nA **small application**.\n\n[Documentation](https://example.com)' }, { id: 'm3', role: 'tool', toolName: 'ipython', content: 'print("hello")' }, { id: 'm4', role: 'tool', toolName: 'ipython', content: 'print("again")' }, { id: 'm5', role: 'assistant', content: 'All done.' }] };
    (window as any).__calls = [];
    const log = (method: string, ...args: any[]) => (window as any).__calls.push([method, ...args]);
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp' }),
      listSessions: async () => sessions,
      listModels: async () => [{ id: 'test/model', name: 'Test model' }],
      getMessages: async (id: string) => messages[id] || [],
      createSession: async (input: any) => { log('create', input); const session = { id: 'test-2', title: input.prompt, cwd: input.cwd, model: input.model || '', status: 'idle', createdAt: now, updatedAt: now }; sessions = [session, ...sessions]; messages[session.id] = [{ id: 'new-1', role: 'user', content: input.prompt }]; return session; },
      sendMessage: async (id: string, text: string) => { log('send', id, text); messages[id].push({ id: `msg-${messages[id].length}`, role: 'user', content: text }); },
      interruptSession: async (id: string) => log('interrupt', id),
      renameSession: async (id: string, title: string) => { log('rename', id, title); sessions = sessions.map(s => s.id === id ? { ...s, title } : s); },
      deleteSession: async (id: string) => { log('delete', id); sessions = sessions.filter(s => s.id !== id); },
      chooseDirectory: async () => '/tmp/chosen-workspace',
      openDirectory: async (path: string) => log('open', path),
    };
  });
});

test('renders sessions, Markdown, and tool calls condensed into one trace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /good ideas deserve/i })).toBeVisible();
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Documentation' })).toHaveAttribute('target', '_blank');
  await expect(page.getByText('All done.')).toBeVisible();
  await expect(page.locator('.trace')).toHaveCount(1);
  await expect(page.locator('summary').filter({ hasText: 'ipython' }).first()).toBeHidden();
  await page.locator('summary').filter({ hasText: 'Thought process' }).click();
  await expect(page.locator('summary').filter({ hasText: 'ipython' })).toHaveCount(2);
  await page.locator('summary').filter({ hasText: 'ipython' }).first().click();
  await expect(page.locator('pre').first()).toContainText('print("hello")');
  await page.getByRole('textbox', { name: 'Message Prime' }).fill('Continue the review');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Continue the review', { exact: true })).toBeVisible();
});

test('creates a session with an explicit workspace and model', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
  await page.locator('.folder-control').click();
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('test/model');
  await page.getByRole('textbox', { name: 'Message Prime' }).fill('Build a task app');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: /Build a task app/ })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls)).toContainEqual(['create', { prompt: 'Build a task app', cwd: '/tmp/chosen-workspace', model: 'test/model' }]);
});

test('searches, renames and confirms deletion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('no-match');
  await expect(page.getByText('No matching sessions')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Rename session', exact: true }).click();
  await page.getByRole('textbox', { name: 'Session title' }).fill('Architecture review');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('button', { name: /Architecture review/ })).toBeVisible();
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Delete session', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.some((call: any[]) => call[0] === 'delete'))).toBe(false);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete session', exact: true }).click();
  await expect(page.getByRole('button', { name: /Architecture review/ })).toHaveCount(0);
});

test('disconnected mode is honest and cannot send', async ({ page }) => {
  await page.addInitScript(() => { (window as any).prime.status = async () => ({ connected: false, home: '/tmp', error: 'CLI unavailable' }); });
  await page.goto('/');
  await expect(page.getByText('Agent disconnected', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Prime' }).fill('Hello');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
});


test('model discovery failure does not hide sessions', async ({ page }) => {
  await page.addInitScript(() => { (window as any).prime.listModels = async () => { throw new Error('Model discovery unavailable'); }; });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Explore the workspace/ })).toBeVisible();
});

test('running session exposes stop without sending another prompt', async ({ page }) => {
  await page.addInitScript(() => {
    const api = (window as any).prime; const list = api.listSessions;
    api.listSessions = async () => (await list()).map((s: any) => ({ ...s, status: 'running' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await page.getByRole('button', { name: 'Stop generation' }).click();
  expect(await page.evaluate(() => (window as any).__calls)).toContainEqual(['interrupt', 'test-1']);
});

test('untrusted Markdown cannot execute HTML or load remote images', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).prime.getMessages = async () => [{ id: 'unsafe', role: 'assistant', content: '<script>window.compromised = true</script>\n\n![tracking](https://tracker.invalid/pixel.png)\n\n[unsafe](javascript:alert(1))' }];
  });
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await expect(page.locator('.message.assistant')).toBeVisible();
  expect(await page.evaluate(() => (window as any).compromised)).toBeUndefined();
  await expect(page.locator('.markdown img')).toHaveCount(0);
  expect(requests.some(url => url.includes('tracker.invalid'))).toBe(false);
});


test('uses independent branding and clearly disclaims upstream affiliation', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Session Dock');
  await expect(page.locator('.brand')).toHaveText('Session Dock');
  await expect(page.getByText('Unofficial companion for Prime Agent', { exact: true })).toBeVisible();
  await expect(page.locator('.sidebar-footer')).toContainText('COMMUNITY BUILT');
  await expect(page.locator('.sidebar-footer')).not.toContainText('PRIME INTELLECT');
  await page.getByRole('button', { name: 'About Session Dock', exact: true }).click();
  const about = page.getByRole('dialog');
  await expect(about.locator('.about-logo')).toHaveText('Session Dock');
  await expect(about).toContainText('not affiliated with or endorsed by Prime Intellect');
  await expect(about).toContainText('Prime Agent is a separate project');
});


test('copy uses native bridge and displays failures', async ({ page }) => {
  await page.addInitScript(() => { (window as any).prime.copyText = async () => { throw Error('Clipboard unavailable'); }; });
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await page.getByRole('button', { name: 'Copy response', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText('Copy failed: Clipboard unavailable');
  await page.evaluate(() => { (window as any).prime.copyText = async (text: string) => { (window as any).__copied = text; }; });
  await page.getByRole('button', { name: 'Copy response', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Response copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__copied)).toContain('Project overview');
});


test('long transcripts are windowed and draft edits preserve message DOM', async ({ page }) => {
  await page.addInitScript(() => { (window as any).prime.getMessages = async () => Array.from({ length: 250 }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: `## Message ${i}\nA small **Markdown** response.` })); });
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the workspace/ }).click();
  await expect(page.locator('.message')).toHaveCount(100);
  await page.evaluate(() => { const node = document.querySelector('.message'); (window as any).__messageNode = node; (window as any).__mutations = 0; new MutationObserver(records => { (window as any).__mutations += records.length; }).observe(node!, { subtree: true, childList: true, attributes: true }); });
  await page.getByRole('textbox', { name: 'Message Prime' }).fill('Typing should not reparse Markdown');
  expect(await page.evaluate(() => (window as any).__mutations)).toBe(0);
  await page.getByRole('button', { name: /Load earlier messages/ }).click();
  await expect(page.locator('.message')).toHaveCount(200);
});


test('narrow sidebar is inert when closed and traps focus when open', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto('/');
  await expect(page.locator('aside')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await expect(page.locator('aside')).not.toHaveAttribute('inert', '');
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  for (let i = 0; i < 16; i++) { await page.keyboard.press('Tab'); expect(await page.locator('aside').evaluate(node => node.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(page.locator('aside')).toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeFocused();
});


test('About exposes bundled third-party acknowledgements', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'About Session Dock', exact: true }).click();
  await page.getByText('Third-party acknowledgements', { exact: true }).click();
  await expect(page.locator('.third-party-notices pre')).toContainText('MIT');
  await expect(page.locator('.third-party-notices pre')).toContainText('react');
});


test('model search and setup guidance are available', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search models' }).fill('nonexistent');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true }).locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Connection & setup', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'CLI executable' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('/login');
});
