import { test as base } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export { expect, type Page } from '@playwright/test';

// With UI_COVERAGE_DIR set (npm run test:ui:coverage), each test saves the V8 coverage of the
// app's own modules for scripts/ui-coverage.mjs. Otherwise this is plain Playwright `test`.
const coverageDir = process.env.UI_COVERAGE_DIR;
const appSource = /^https?:\/\/[^/]+\/(src|shared|electron)\/[^?]+\.tsx?(\?|$)/;

export const test = base.extend<{ uiCoverage: void }>({
  uiCoverage: [async ({ page, browserName }, use, testInfo) => {
    if (!coverageDir || browserName !== 'chromium') { await use(); return; }
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use();
    const entries = (await page.coverage.stopJSCoverage()).filter(entry => appSource.test(entry.url));
    mkdirSync(coverageDir, { recursive: true });
    writeFileSync(join(coverageDir, `${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}.json`), JSON.stringify(entries));
  }, { auto: true }],
});
