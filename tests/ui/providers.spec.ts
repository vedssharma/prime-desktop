import { test, expect, type Page } from '@playwright/test';
import type { ModelOption } from '../../shared/types';

// Start from the real browser fallback. Only model discovery and clipboard calls
// are replaced; these tests cannot reach credentials or a live auth service.
async function openProviders(page: Page, models?: ModelOption[]) {
  await page.goto('/');
  await expect(page.getByText('Agent disconnected', { exact: true })).toBeVisible();
  if (models) {
    await page.evaluate(models => {
      const controls = { models, reads: 0, error: false, copyError: false, copied: [] as string[] };
      (window as any).__providers = controls;
      window.prime.listModels = async () => {
        controls.reads++;
        if (controls.error) throw new Error('Model discovery unavailable');
        return controls.models;
      };
      window.prime.copyText = async text => {
        if (controls.copyError) throw new Error('Clipboard unavailable');
        controls.copied.push(text);
      };
    }, models);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  return page.locator('details').filter({ has: page.locator('summary', { hasText: 'Providers & models' }) });
}

const catalog = [
  { id: 'openrouter/anthropic/claude-sonnet', name: 'Claude Sonnet' },
  { id: 'openrouter/google/gemini-flash', name: 'Gemini Flash' },
  { id: 'anthropic/claude-opus', name: 'Claude Opus' },
];

test('browser fallback keeps provider guidance closed until expanded', async ({ page }) => {
  const panel = await openProviders(page);
  await expect(panel).not.toHaveAttribute('open');
  await expect(panel.getByRole('button', { name: 'Copy login command' })).toHaveCount(0);
  const summary = panel.locator('summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(panel).toHaveAttribute('open', '');
  await expect(panel.getByRole('heading', { name: 'Models available', exact: true })).toBeVisible();
  await expect(panel.getByText('No models available yet.', { exact: false })).toBeVisible();
  await expect(panel.getByText(/not provider sign-in or credential validity/)).toBeVisible();
  await expect(panel.locator('input[type="password"]')).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await summary.press('Enter');
  await expect(panel.getByRole('button', { name: 'Copy login command' })).toHaveCount(0);
});

test('groups nested identifiers by the first slash and searches names and full IDs', async ({ page }) => {
  const panel = await openProviders(page, catalog);
  expect(await page.evaluate(() => (window as any).__providers.reads)).toBe(0);
  await panel.locator('summary').click();
  const openrouter = panel.getByRole('region', { name: 'openrouter models', exact: true });
  const anthropic = panel.getByRole('region', { name: 'anthropic models', exact: true });
  await expect(openrouter.getByRole('heading')).toHaveText('openrouter 2 models');
  await expect(anthropic.getByRole('heading')).toHaveText('anthropic 1 model');
  await expect(openrouter.locator('li')).toHaveCount(2);
  await expect(openrouter.getByText('openrouter/anthropic/claude-sonnet', { exact: true })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('3 models across 2 providers.');
  const search = panel.getByRole('searchbox', { name: 'Search available models' });
  await search.fill('  GEMINI FLASH  ');
  await expect(openrouter.locator('li')).toHaveCount(1);
  await expect(anthropic).toHaveCount(0);
  await search.fill('openrouter/anthropic/');
  await expect(openrouter.getByText('Claude Sonnet', { exact: true })).toBeVisible();
  await expect(openrouter.getByRole('heading')).toHaveText('openrouter 2 models');
  await search.fill('not-a-model');
  await expect(panel.getByText('No models match your search.')).toBeVisible();
  await search.fill('');
  await expect(panel.getByRole('region')).toHaveCount(2);
});

test('refresh after CLI login updates the catalog and parent model picker', async ({ page }) => {
  const panel = await openProviders(page, catalog);
  await panel.locator('summary').click();
  await expect(panel.getByRole('status')).toHaveText('3 models across 2 providers.');
  await page.evaluate(() => {
    (window as any).__providers.models = [{ id: 'new-provider/team/new-model', name: 'New model after login' }];
  });
  await panel.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('1 model across 1 provider.');
  await expect(panel.getByRole('region', { name: 'new-provider models', exact: true })).toContainText('new-provider/team/new-model');
  await expect(panel.getByRole('region', { name: 'openrouter models', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true }).locator('option[value="new-provider/team/new-model"]')).toHaveText('New model after login');
});

test('model discovery failure gives actionable recovery and preserves the last catalog', async ({ page }) => {
  const panel = await openProviders(page, catalog);
  await page.evaluate(() => { (window as any).__providers.error = true; });
  await panel.locator('summary').click();
  await expect(panel.getByRole('alert')).toContainText('Could not load models. Start prime-agent');
  await expect(panel.getByRole('alert')).toContainText('check the app connection');
  await expect(panel.getByRole('button', { name: 'Refresh models', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__providers.error = false; });
  await panel.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveText('3 models across 2 providers.');
  await page.evaluate(() => { (window as any).__providers.error = true; });
  await panel.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Showing the last loaded catalog.');
  await expect(panel.getByText('openrouter/anthropic/claude-sonnet', { exact: true })).toBeVisible();
});

test('copies only launch and login commands, with clear success and failure feedback', async ({ page }) => {
  const panel = await openProviders(page, []);
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Copy launch command', exact: true }).click();
  await expect(panel.getByText('Copied prime-agent. Paste it into your terminal.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Copy login command', exact: true }).click();
  await expect(panel.getByText('Copied /login. Paste it into the Prime Agent CLI.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__providers.copied)).toEqual(['prime-agent', '/login']);
  await expect(panel.locator('li').filter({ hasText: 'After signing in' })).toContainText('/model');
  await page.evaluate(() => { (window as any).__providers.copyError = true; });
  await panel.getByRole('button', { name: 'Copy login command', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Could not copy. Type /login into the Prime Agent CLI instead.');
  await expect(panel.getByText('Copied /login. Paste it into the Prime Agent CLI.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__providers.copyError = false; });
  await panel.getByRole('button', { name: 'Copy login command', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});
