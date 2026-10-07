#!/usr/bin/env node
// UI test coverage: runs the Playwright suite with V8 coverage collection (tests/ui/fixtures.ts),
// then maps it back to src/ through Vite's inline source maps and prints a per-file table.
// `--report-only` skips the run and reports what an earlier run with UI_COVERAGE_DIR collected.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CoverageReport } from 'monocart-coverage-reports';

const raw = resolve(process.env.UI_COVERAGE_DIR || 'coverage/ui-raw');
const reportOnly = process.argv.includes('--report-only');

if (!reportOnly) {
  rmSync(raw, { recursive: true, force: true });
  const extra = process.argv.slice(2).filter(arg => arg !== '--report-only');
  const run = spawnSync('npx', ['playwright', 'test', ...extra], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, UI_COVERAGE_DIR: raw } });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

// Vite names each module's source by its bare file name; restore the path from the module URL so
// src/attachments.ts and electron/attachments.ts stay distinct.
const SOURCE_MAP = /\/\/# sourceMappingURL=data:application\/json;base64,(\S+)\s*$/;
function withSourceMap(entry) {
  const match = SOURCE_MAP.exec(entry.source ?? '');
  if (!match) return entry;
  const directory = new URL(entry.url).pathname.slice(1).replace(/[^/]+$/, '');
  const map = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  map.sources = map.sources.map(source => directory + source.replace(/^.*\//, ''));
  delete map.sourceRoot;
  return { ...entry, source: entry.source.slice(0, match.index), sourceMap: map };
}

const files = (() => { try { return readdirSync(raw).filter(name => name.endsWith('.json')); } catch { return []; } })();
if (!files.length) {
  console.error(`No UI coverage data in ${raw}. Run npm run test:ui:coverage.`);
  process.exit(1);
}
const report = new CoverageReport({
  name: 'UI test coverage',
  outputDir: 'coverage/ui',
  reports: [['console-details', { metrics: ['lines', 'branches', 'functions'] }], 'json-summary', 'markdown-summary'],
  sourceFilter: path => /^(src|shared|electron)\//.test(path),
});
for (const file of files) await report.add(JSON.parse(readFileSync(resolve(raw, file), 'utf8')).map(withSourceMap));
await report.generate();
