import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch();
try { const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading', { name: /good ideas deserve/i }).waitFor();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/preview.png' });
} finally { await browser.close(); }
