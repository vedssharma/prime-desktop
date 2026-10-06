import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import asar from '@electron/asar';
import { build } from 'vite';
import { checkProductionCsp, verifyArchiveCsp } from '../scripts/check-package.mjs';

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

test('archive check reads the packaged index.html', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'csp-archive-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'app/dist'), { recursive: true });
  const pack = async (policy) => {
    writeFileSync(path.join(root, 'app/dist/index.html'), page(policy));
    const archive = path.join(root, `app-${Math.random()}.asar`);
    await asar.createPackage(path.join(root, 'app'), archive);
    return archive;
  };
  const good = await pack("default-src 'self'; connect-src 'self';");
  assert.doesNotThrow(() => verifyArchiveCsp(good));
  assert.throws(() => verifyArchiveCsp(path.join(root, 'missing.asar')), /Missing dist\/index.html/);
  const bad = await pack("default-src 'self'; connect-src 'self' ws://127.0.0.1:5173;");
  assert.throws(() => verifyArchiveCsp(bad), /WebSocket/);
});
