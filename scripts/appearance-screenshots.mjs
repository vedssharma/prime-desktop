import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await mkdir('artifacts', { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ animations: 'disabled', path: 'artifacts/settings-light.png' });
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.getByRole('radio', { name: 'Slate', exact: true }).check();
  await page.getByRole('button', { name: 'Blue accent', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'artifacts/settings-dark.png' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'artifacts/welcome-dark.png' });
} finally { await browser.close(); }
