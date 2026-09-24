import { test, expect, type Page } from '@playwright/test';

const appearanceKey = 'session-dock.appearance.v1';
const preferencesKey = 'prime-desktop.preferences.v1';

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  return dialog;
}

async function expectAppearance(page: Page, theme: 'light' | 'dark', palette: string, accent: string) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe(accent);
}

async function storedAppearance(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), appearanceKey);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
});

test('browser preview opens Settings with the default appearance', async ({ page }) => {
  // Use the real browser fallback. Appearance must not need a daemon connection.
  await page.goto('/');
  await expect(page.getByText('Agent disconnected', { exact: true })).toBeVisible();
  const dialog = await openSettings(page);
  await expect(dialog.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Theme', exact: true }).getByRole('radio')).toHaveCount(3);
  await expect(dialog.getByRole('group', { name: 'Palette', exact: true }).getByRole('radio')).toHaveCount(3);
  await expect(dialog.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Stone', exact: true })).toBeChecked();
  await expect(dialog.getByLabel('Custom accent color', { exact: true })).toHaveAttribute('type', 'color');
  await expect(dialog.getByLabel('Accent hex value', { exact: true })).toHaveValue('#c0ee65');
  await expectAppearance(page, 'light', 'stone', '#c0ee65');
});

test('theme, palette, and accent apply immediately and persist through Done and reload', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Slate', exact: true }).check();
  await dialog.getByRole('button', { name: 'Violet accent', exact: true }).click();
  await expectAppearance(page, 'dark', 'slate', '#aa8cf2');
  await expect.poll(() => storedAppearance(page)).toEqual({ theme: 'dark', palette: 'slate', accent: '#aa8cf2' });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expectAppearance(page, 'dark', 'slate', '#aa8cf2');
  const reopened = await openSettings(page);
  await expect(reopened.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(reopened.getByRole('radio', { name: 'Slate', exact: true })).toBeChecked();
  await expect(reopened.getByLabel('Accent hex value', { exact: true })).toHaveValue('#aa8cf2');
});

test('System follows live OS changes, while explicit themes do not', async ({ page }) => {
  await page.goto('/');
  await expectAppearance(page, 'light', 'stone', '#c0ee65');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAppearance(page, 'dark', 'stone', '#c0ee65');
  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: 'Light', exact: true }).check();
  await expectAppearance(page, 'light', 'stone', '#c0ee65');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAppearance(page, 'light', 'stone', '#c0ee65');
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.emulateMedia({ colorScheme: 'light' });
  await expectAppearance(page, 'dark', 'stone', '#c0ee65');
  await dialog.getByRole('radio', { name: 'System', exact: true }).check();
  await expectAppearance(page, 'light', 'stone', '#c0ee65');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAppearance(page, 'dark', 'stone', '#c0ee65');
  await page.reload();
  await expectAppearance(page, 'dark', 'stone', '#c0ee65');
  await expect((await openSettings(page)).getByRole('radio', { name: 'System', exact: true })).toBeChecked();
});

test('all accent presets and palettes apply without closing Settings', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  for (const palette of ['Stone', 'Slate', 'Sand']) {
    await dialog.getByRole('radio', { name: palette, exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-palette', palette.toLowerCase());
  }
  for (const [name, hex] of [['Blue', '#5799ed'], ['Violet', '#aa8cf2'], ['Rose', '#ee819d'], ['Amber', '#efb64e'], ['Lime', '#c0ee65']]) {
    const preset = dialog.getByRole('button', { name: `${name} accent`, exact: true });
    await preset.click();
    await expect(preset).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByLabel('Custom accent color', { exact: true })).toHaveValue(hex);
    await expect(dialog.getByLabel('Accent hex value', { exact: true })).toHaveValue(hex);
    await expectAppearance(page, 'light', 'sand', hex);
  }
});

test('custom colors accept six-digit hex with or without # on Enter or blur', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  const hex = dialog.getByLabel('Accent hex value', { exact: true });
  await hex.fill('A1B2C3');
  await hex.press('Enter');
  await expectAppearance(page, 'light', 'stone', '#a1b2c3');
  await expect(dialog).toBeVisible();
  await hex.fill('#123ABC');
  await hex.press('Tab');
  await expectAppearance(page, 'light', 'stone', '#123abc');
  await dialog.getByLabel('Custom accent color', { exact: true }).fill('#7539ac');
  await expectAppearance(page, 'light', 'stone', '#7539ac');
  await expect(hex).toHaveValue('#7539ac');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expectAppearance(page, 'light', 'stone', '#7539ac');
  await page.reload();
  await expectAppearance(page, 'light', 'stone', '#7539ac');
});

test('invalid hex shows an inline error without changing or persisting the accent', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Blue accent', exact: true }).click();
  const before = await storedAppearance(page);
  const hex = dialog.getByLabel('Accent hex value', { exact: true });
  for (const invalid of ['#xyzxyz', '#123', 'red', '']) {
    await hex.fill(invalid);
    await hex.press('Enter');
    await expect(hex).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByRole('alert')).toContainText(/six-digit|hex/i);
    await expectAppearance(page, 'light', 'stone', '#5799ed');
    expect(await storedAppearance(page)).toEqual(before);
  }
  await hex.fill('#zzzzzz');
  await hex.press('Tab');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expectAppearance(page, 'light', 'stone', '#5799ed');
  await hex.fill('123456');
  await hex.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expectAppearance(page, 'light', 'stone', '#123456');
});

test('reset restores System, Stone, and Lime without clearing drafts or workspace preferences', async ({ page }) => {
  await page.addInitScript(({ key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ cwd: '/tmp/appearance-workspace', model: 'test/saved-model' }));
  }, { key: preferencesKey });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message Prime', exact: true });
  await composer.fill('Private draft survives appearance edits');
  const preferences = await page.evaluate(key => localStorage.getItem(key), preferencesKey);
  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Sand', exact: true }).check();
  await dialog.getByRole('button', { name: 'Rose accent', exact: true }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(composer).toHaveValue('Private draft survives appearance edits');
  await expect(page.locator('.folder-control')).toHaveAttribute('title', '/tmp/appearance-workspace');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('test/saved-model');
  await openSettings(page);
  await dialog.getByRole('button', { name: 'Reset appearance', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Stone', exact: true })).toBeChecked();
  await expectAppearance(page, 'light', 'stone', '#c0ee65');
  await expect.poll(() => storedAppearance(page)).toEqual({ theme: 'system', palette: 'stone', accent: '#c0ee65' });
  await page.keyboard.press('Escape');
  await expect(composer).toHaveValue('Private draft survives appearance edits');
  expect(await page.evaluate(key => localStorage.getItem(key), preferencesKey)).toBe(preferences);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('Private draft');
  await page.reload();
  await expectAppearance(page, 'light', 'stone', '#c0ee65');
  await expect(page.locator('.folder-control')).toHaveAttribute('title', '/tmp/appearance-workspace');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('test/saved-model');
});

for (const [label, value] of [
  ['malformed JSON', '{not-json'],
  ['invalid fields', JSON.stringify({ theme: 'sepia', palette: 'neon', accent: 'red' })],
  ['wrong field types', JSON.stringify({ theme: null, palette: 42, accent: {} })],
  ['null', 'null'],
]) {
  test(`invalid stored appearance falls back safely: ${label}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: appearanceKey, value });
    await page.goto('/');
    await expectAppearance(page, 'light', 'stone', '#c0ee65');
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('radio', { name: 'System', exact: true })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Stone', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Accent hex value', { exact: true })).toHaveValue('#c0ee65');
  });
}

test('keyboard focus stays inside Settings, reaches inputs, and returns to its opener', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Settings', exact: true });
  await opener.focus();
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  const controls = dialog.locator('button:visible, input:visible, select:visible, textarea:visible, a[href]:visible, summary:visible');
  const seen = new Set<string>();
  // Two complete cycles cover native radio-group tab behavior and both boundaries.
  for (let i = 0; i < (await controls.count()) * 2; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    seen.add(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || ''));
  }
  expect(seen.has('Custom accent color')).toBe(true);
  expect(seen.has('Accent hex value')).toBe(true);
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await dialog.getByRole('radio', { name: 'System', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await dialog.getByLabel('Accent hex value', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

// Independent WCAG calculation: do not reuse the implementation's contrast helper.
function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) => rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('accent foreground and accent text keep readable contrast across themes and palettes', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  for (const theme of ['Light', 'Dark']) {
    await dialog.getByRole('radio', { name: theme, exact: true }).check();
    for (const palette of ['Stone', 'Slate', 'Sand']) {
      await dialog.getByRole('radio', { name: palette, exact: true }).check();
      for (const accent of ['#c0ee65', '#000000', '#ffffff', '#777777']) {
        await dialog.getByLabel('Custom accent color', { exact: true }).fill(accent);
        const colors = await page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          return ['--accent', '--on-accent', '--accent-text', '--canvas'].map(token => {
            const value = style.getPropertyValue(token).trim();
            if (!value) throw new Error(`Missing appearance token ${token}`);
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = value;
            context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
          });
        });
        const description = `${theme}/${palette}/${accent}`;
        expect(contrast(colors[0], colors[1]), `Accent foreground: ${description}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors[2], colors[3]), `Accent text on canvas: ${description}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
