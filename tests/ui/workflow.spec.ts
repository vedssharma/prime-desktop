import { test, expect, type Page } from '@playwright/test';

// Keep mutation responses under test control. No network or wall-clock sleeps.
async function openApp(page: Page, running = false) {
  await page.addInitScript(({ running }) => {
    const now = new Date().toISOString();
    let sessions = [
      { id: 'alpha', title: 'Alpha session', cwd: '/tmp/alpha', model: 'test/first', status: running ? 'running' : 'idle', createdAt: now, updatedAt: now },
      { id: 'beta', title: 'Beta session', cwd: '/tmp/beta', model: 'test/first', status: 'idle', createdAt: now, updatedAt: now },
    ];
    const messages: Record<string, any[]> = { alpha: [], beta: [] };
    const calls: any[][] = [];
    const controls = {
      calls,
      readError: '',
      listError: '',
      settleSend: null as null | ((error?: string) => void),
      settleCreate: null as null | ((error?: string) => void),
    };
    (window as any).__workflow = controls;
    (window as any).prime = {
      status: async () => ({ connected: true, version: 'test', home: '/tmp/home' }),
      connect: async () => ({ connected: true, version: 'test', home: '/tmp/home' }),
      listSessions: async () => {
        calls.push(['list']);
        if (controls.listError) throw new Error(controls.listError);
        return sessions;
      },
      listModels: async () => [{ id: 'test/first', name: 'First model' }, { id: 'test/chosen', name: 'Chosen model' }],
      getMessages: async (id: string) => {
        calls.push(['read', id]);
        if (controls.readError) throw new Error(controls.readError);
        return messages[id] || [];
      },
      sendMessage: (id: string, text: string) => {
        calls.push(['send', id, text]);
        return new Promise<void>((resolve, reject) => {
          controls.settleSend = (error?: string) => {
            controls.settleSend = null;
            if (error) reject(new Error(error));
            else {
              messages[id].push({ id: `message-${messages[id].length}`, role: 'user', content: text });
              resolve();
            }
          };
        });
      },
      createSession: (input: any) => {
        calls.push(['create', input]);
        return new Promise((resolve, reject) => {
          controls.settleCreate = (error?: string) => {
            controls.settleCreate = null;
            if (error) reject(new Error(error));
            else {
              const created = { id: 'created', title: input.prompt, cwd: input.cwd, model: input.model || '', status: 'idle', createdAt: now, updatedAt: now };
              sessions = [created, ...sessions];
              messages.created = [{ id: 'created-message', role: 'user', content: input.prompt }];
              resolve(created);
            }
          };
        });
      },
      interruptSession: async (id: string) => { calls.push(['interrupt', id]); },
      renameSession: async () => {},
      deleteSession: async () => {},
      chooseDirectory: async () => '/tmp/chosen-workspace',
      openDirectory: async () => {},
    };
  }, { running });
  await page.goto('/');
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alpha session/ })).toBeVisible();
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Prime' });
const selectSession = (page: Page, name: 'Alpha' | 'Beta') => page.getByRole('button', { name: new RegExp(`${name} session`) }).click();
const newSession = (page: Page) => page.getByRole('button', { name: /New session/ }).click();

async function settleSend(page: Page, error?: string) {
  await expect.poll(() => page.evaluate(() => typeof (window as any).__workflow.settleSend)).toBe('function');
  await page.evaluate(error => (window as any).__workflow.settleSend(error), error);
}

async function expectCall(page: Page, call: any[]) {
  await expect.poll(() => page.evaluate(() => (window as any).__workflow.calls)).toContainEqual(call);
}

test('keeps independent new-session and session drafts, including repeated selections', async ({ page }) => {
  await openApp(page);
  await composer(page).fill('Private new-session draft');
  await newSession(page);
  await newSession(page);
  await expect(composer(page)).toHaveValue('Private new-session draft');
  await selectSession(page, 'Alpha');
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill('Alpha draft');
  await selectSession(page, 'Alpha');
  await expect(composer(page)).toHaveValue('Alpha draft');
  await selectSession(page, 'Beta');
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill('Beta draft');
  await selectSession(page, 'Alpha');
  await expect(composer(page)).toHaveValue('Alpha draft');
  await newSession(page);
  await expect(composer(page)).toHaveValue('Private new-session draft');
  await selectSession(page, 'Beta');
  await expect(composer(page)).toHaveValue('Beta draft');
});

test('reload preserves workspace and model preferences but never private drafts', async ({ page }) => {
  await openApp(page);
  await page.locator('.folder-control').click();
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('test/chosen');
  await composer(page).fill('Private new-session draft');
  await selectSession(page, 'Alpha');
  await composer(page).fill('Private Alpha draft');
  await selectSession(page, 'Beta');
  await composer(page).fill('Private Beta draft');
  await page.reload();
  await expect(page.getByText('Agent connected', { exact: true })).toBeVisible();
  await newSession(page);
  await expect(composer(page)).toHaveValue('');
  await expect(page.locator('.folder-control')).toHaveAttribute('title', '/tmp/chosen-workspace');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('test/chosen');
  for (const name of ['Alpha', 'Beta'] as const) {
    await selectSession(page, name);
    await expect(composer(page)).toHaveValue('');
  }
  // Do not merely hide persisted drafts: ensure no draft text is in browser storage.
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('Private');
  await newSession(page);
  await composer(page).fill('Use my saved preferences');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expectCall(page, ['create', { prompt: 'Use my saved preferences', cwd: '/tmp/chosen-workspace', model: 'test/chosen' }]);
});

test('running sessions offer Queue follow-up alongside Stop generation and confirm acceptance', async ({ page }) => {
  await openApp(page, true);
  await newSession(page);
  await composer(page).fill('Keep new-session draft');
  await selectSession(page, 'Beta');
  await composer(page).fill('Keep Beta draft');
  await selectSession(page, 'Alpha');
  await expect(page.getByRole('button', { name: 'Queue follow-up', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible();
  await composer(page).fill('Review the tests next');
  await page.getByRole('button', { name: 'Queue follow-up', exact: true }).click();
  await expectCall(page, ['send', 'alpha', 'Review the tests next']);
  await settleSend(page);
  await expect(page.getByText(/^Follow-up queued(?:[.!]|$)/)).toBeVisible();
  await expect(composer(page)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeEnabled();
  await selectSession(page, 'Beta');
  await expect(composer(page)).toHaveValue('Keep Beta draft');
  await newSession(page);
  await expect(composer(page)).toHaveValue('Keep new-session draft');
});

test('rejected follow-up keeps the draft and allows retry', async ({ page }) => {
  await openApp(page, true);
  await selectSession(page, 'Alpha');
  await composer(page).fill('Keep this rejected follow-up');
  await page.getByRole('button', { name: 'Queue follow-up', exact: true }).click();
  await settleSend(page, 'Queue rejected by backend');
  await expect(page.getByRole('alert')).toContainText('Queue rejected by backend');
  await expect(composer(page)).toHaveValue('Keep this rejected follow-up');
  await expect(page.getByText(/^Follow-up queued(?:[.!]|$)/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Queue follow-up', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Queue follow-up', exact: true }).click();
  await settleSend(page);
  await expect(page.getByText(/^Follow-up queued(?:[.!]|$)/)).toBeVisible();
  await expect(composer(page)).toHaveValue('');
});

test('late send acceptance clears only its submitted session draft, not the visible draft', async ({ page }) => {
  await openApp(page);
  await selectSession(page, 'Alpha');
  await composer(page).fill('Submitted Alpha draft');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expectCall(page, ['send', 'alpha', 'Submitted Alpha draft']);
  await selectSession(page, 'Beta');
  await composer(page).fill('Unsubmitted Beta draft');
  await settleSend(page);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(composer(page)).toHaveValue('Unsubmitted Beta draft');
  await selectSession(page, 'Alpha');
  await expect(composer(page)).toHaveValue('');
  await selectSession(page, 'Beta');
  await expect(composer(page)).toHaveValue('Unsubmitted Beta draft');
});

test('typing a replacement while a send is in flight preserves the newer draft', async ({ page }) => {
  await openApp(page);
  await selectSession(page, 'Alpha');
  await composer(page).fill('First prompt');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expectCall(page, ['send', 'alpha', 'First prompt']);
  await composer(page).fill('Newer draft written before acceptance');
  await settleSend(page);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(composer(page)).toHaveValue('Newer draft written before acceptance');
  await selectSession(page, 'Beta');
  await selectSession(page, 'Alpha');
  await expect(composer(page)).toHaveValue('Newer draft written before acceptance');
});

test('late session creation does not navigate away or erase another composer', async ({ page }) => {
  await openApp(page);
  await composer(page).fill('Create a session asynchronously');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__workflow.settleCreate)).toBe('function');
  await selectSession(page, 'Beta');
  await composer(page).fill('Stay in Beta');
  await page.evaluate(() => (window as any).__workflow.settleCreate());
  await expect(page.getByRole('button', { name: /Create a session asynchronously/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Beta session/ })).toHaveAttribute('aria-current', 'page');
  await expect(composer(page)).toHaveValue('Stay in Beta');
  await newSession(page);
  await expect(composer(page)).toHaveValue('');
});

for (const failure of ['readError', 'listError'] as const) {
  test(`accepted follow-up remains accepted when the next ${failure === 'readError' ? 'message read' : 'session refresh'} fails`, async ({ page }) => {
    await openApp(page, true);
    await selectSession(page, 'Alpha');
    await expect(page.getByRole('heading', { name: 'The next step is yours.' })).toBeVisible();
    await composer(page).fill('Accepted follow-up must not return');
    await page.getByRole('button', { name: 'Queue follow-up', exact: true }).click();
    await expectCall(page, ['send', 'alpha', 'Accepted follow-up must not return']);
    await page.evaluate(failure => { (window as any).__workflow[failure] = 'Refresh temporarily unavailable'; }, failure);
    await settleSend(page);
    await expect(page.getByText(/^Follow-up queued(?:[.!]|$)/)).toBeVisible();
    await expect(composer(page)).toHaveValue('');
    await expect(page.getByRole('alert')).toContainText(/refresh|read|load|unavailable/i);
    await expect(page.getByRole('alert')).not.toContainText(/(?:send|sending|queue|queuing)\s+(?:has\s+)?failed|failed to (?:send|queue)|not (?:sent|queued)/i);
    await expect(page.getByText(/^Follow-up queued(?:[.!]|$)/)).toBeVisible();
    await expect(composer(page)).toHaveValue('');
    const sends = await page.evaluate(() => (window as any).__workflow.calls.filter((call: any[]) => call[0] === 'send'));
    expect(sends).toHaveLength(1);
  });
}

test('editing a draft back to the submitted text while pending still preserves the new revision', async ({ page }) => {
  await openApp(page);
  await selectSession(page, 'Alpha');
  await composer(page).fill('Same words, new draft revision');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expectCall(page, ['send', 'alpha', 'Same words, new draft revision']);
  await composer(page).fill('Temporary edit');
  await composer(page).fill('Same words, new draft revision');
  await settleSend(page);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(composer(page)).toHaveValue('Same words, new draft revision');
  await selectSession(page, 'Beta');
  await selectSession(page, 'Alpha');
  await expect(composer(page)).toHaveValue('Same words, new draft revision');
});


test('modal blocks New session shortcut and background submission', async ({ page }) => {
  await openApp(page);
  await selectSession(page, 'Alpha');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Control+n');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.locator('main').getAttribute('inert')).not.toBeNull();
  expect(await page.locator('aside').getAttribute('inert')).not.toBeNull();
  await expect(page.locator('.session-item[aria-current="page"]')).toContainText('Alpha session');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__workflow.calls.filter((c: any[]) => ['create', 'send'].includes(c[0])))).toEqual([]);
});

test('send completion cannot steal modal focus', async ({ page }) => {
  await openApp(page);
  await selectSession(page, 'Alpha');
  await composer(page).fill('Prompt');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settleSend(page);
  await expect.poll(() => page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
  await expect(page.locator('main')).toHaveAttribute('inert', '');
});


test('pending delete cannot be dismissed by Escape or background navigation', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { (window as any).prime.deleteSession = () => new Promise<void>(resolve => { (window as any).__resolveDelete = resolve; }); });
  await selectSession(page, 'Alpha');
  await page.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('button', { name: 'Delete session', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete session', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(page.locator('aside')).toHaveAttribute('inert', '');
  await page.evaluate(() => (window as any).__resolveDelete());
  await expect(dialog).toHaveCount(0);
});


test('old polling reply cannot overwrite a newer post-send transcript', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await selectSession(page, 'Alpha');
  await expect(page.getByRole('heading', { name: 'The next step is yours.' })).toBeVisible();
  await page.evaluate(() => {
    const api = (window as any).prime; const original = api.getMessages; let first = true;
    api.getMessages = (id: string) => { if (first) { first = false; return new Promise(resolve => { (window as any).__oldRead = () => resolve([]); }); } return original(id); };
  });
  await page.clock.runFor(10001);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__oldRead)).toBe('function');
  await composer(page).fill('Newest message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await settleSend(page);
  await expect(page.getByText('Newest message', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__oldRead());
  await expect(page.getByText('Newest message', { exact: true })).toBeVisible();
});


test('a pending request in one session does not block another session', async ({ page }) => {
  await openApp(page);
  await selectSession(page, 'Alpha');
  await composer(page).fill('Pending Alpha');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await selectSession(page, 'Beta'); await composer(page).fill('Independent Beta');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await selectSession(page, 'Alpha');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await settleSend(page);
  await page.getByText('Work & queue status', { exact: true }).click();
  await expect(page.getByText(/This is not an empty-queue report/)).toBeVisible();
});
