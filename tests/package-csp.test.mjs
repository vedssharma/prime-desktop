import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import { checkProductionCsp } from '../scripts/check-package.mjs';

const page = policy => `<meta http-equiv="Content-Security-Policy" content="${policy}"/>`;

test('source index.html carries the production policy', () => {
  assert.doesNotThrow(() => checkProductionCsp(readFileSync(new URL('../index.html', import.meta.url), 'utf8')));
});

test('production build keeps the dev server out of the policy', async () => {
  const output = await build({ logLevel: 'silent', build: { write: false } });
  const html = output.output.find(file => file.fileName === 'index.html').source;
  assert.doesNotThrow(() => checkProductionCsp(html));
  assert.doesNotMatch(html, /5173/);
});

test('dev-only sources are rejected', () => {
  assert.throws(() => checkProductionCsp(page("default-src 'self'; connect-src 'self' ws://127.0.0.1:5173;")), /WebSocket/);
  assert.throws(() => checkProductionCsp(page("default-src 'self'; script-src 'self' 'unsafe-inline';")), /unsafe-inline/);
  assert.throws(() => checkProductionCsp('<html></html>'), /no Content-Security-Policy/);
});
