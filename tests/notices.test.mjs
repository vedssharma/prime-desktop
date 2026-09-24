import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import asar from '@electron/asar';
import { generateNotices, noticeOutputs, productionPackages, checkNotices } from '../scripts/generate-notices.mjs';
import { verifyArchive } from '../scripts/check-package.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'session-dock-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    const filename = path.join(root, name);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
  };
  put('package.json', { name: 'fixture', dependencies: { alpha: '1' }, devDependencies: { excluded: '1' } });
  put('LICENSE', 'Project license\n');
  put('node_modules/alpha/package.json', { name: 'alpha', version: '1.0.0', license: 'MIT', dependencies: { shared: '1' }, peerDependencies: { peer: '1', absent: '1' }, peerDependenciesMeta: { absent: { optional: true } } });
  put('node_modules/alpha/LICENSE', Buffer.from('Copyright Alpha\r\nEXACT  license bytes.\r\n'));
  put('node_modules/alpha/NOTICE.txt', 'Extra required notice\n');
  for (const name of ['shared', 'peer', 'excluded']) {
    put(`node_modules/${name}/package.json`, { name, version: '1.0.0', license: 'ISC' });
    put(`node_modules/${name}/LICENSE`, `License for ${name}\n`);
  }
  put('node_modules/electron/package.json', { name: 'electron', version: '1.0.0', license: 'MIT' });
  put('node_modules/electron/dist/LICENSE', 'Electron license\n');
  put('node_modules/electron/dist/LICENSES.chromium.html', '<html>Chromium notices</html>\n');
  put('public/licenses/dm-sans-OFL.txt', 'DM Sans OFL\n');
  put('public/licenses/space-grotesk-OFL.txt', 'Space Grotesk OFL\n');
  return { root, put };
}

test('walks production and peer graph, excludes dev-only tools, retains exact license and notice bytes', (t) => {
  const { root, put } = fixture(t);
  put('node_modules/alpha/node_modules/shared/package.json', { name: 'shared', version: '2.0.0', license: 'MIT', dependencies: { alpha: '1' } });
  put('node_modules/alpha/node_modules/shared/LICENSE', 'Nested license');
  assert.deepEqual(productionPackages(root).map(({ manifest }) => `${manifest.name}@${manifest.version}`), ['alpha@1.0.0', 'peer@1.0.0', 'shared@2.0.0']);
  const notices = generateNotices(root);
  assert.ok(notices.includes(readFileSync(path.join(root, 'node_modules/alpha/LICENSE'))));
  assert.ok(notices.includes(Buffer.from('Extra required notice\n')));
  assert.ok(!notices.includes(Buffer.from('excluded@')));
  assert.deepEqual(generateNotices(root), notices);
});

test('fails closed on a missing required dependency, license identity, or license text', (t) => {
  for (const scenario of ['dependency', 'identity', 'text']) {
    const { root, put } = fixture(t);
    if (scenario === 'dependency') rmSync(path.join(root, 'node_modules/shared'), { recursive: true });
    if (scenario === 'identity') put('node_modules/shared/package.json', { name: 'shared', version: '1.0.0' });
    if (scenario === 'text') rmSync(path.join(root, 'node_modules/shared/LICENSE'));
    assert.throws(() => generateNotices(root), /Missing/);
  }
});

test('check detects dependency and generated file drift', (t) => {
  const { root, put } = fixture(t);
  for (const [filename, contents] of noticeOutputs(root)) put(filename, contents);
  checkNotices(root);
  put('node_modules/alpha/LICENSE', 'Changed copyright\n');
  assert.throws(() => checkNotices(root), /Stale/);
});

test('archive verification checks exact project, dependencies, fonts and runtime license bytes', async (t) => {
  const { root, put } = fixture(t);
  for (const [filename, contents] of noticeOutputs(root)) put(filename, contents);
  for (const [entry, source] of [
    ['LICENSE', 'LICENSE'], ['THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
    ['dist/notices.txt', 'public/notices.txt'],
    ['dist/licenses/dm-sans-OFL.txt', 'public/licenses/dm-sans-OFL.txt'],
    ['dist/licenses/space-grotesk-OFL.txt', 'public/licenses/space-grotesk-OFL.txt'],
  ]) put(`app/${entry}`, readFileSync(path.join(root, source)));
  put('resources/licenses/electron-LICENSE.txt', readFileSync(path.join(root, 'node_modules/electron/dist/LICENSE')));
  put('resources/licenses/LICENSES.chromium.html', readFileSync(path.join(root, 'node_modules/electron/dist/LICENSES.chromium.html')));
  const archive = path.join(root, 'resources/app.asar');
  await asar.createPackage(path.join(root, 'app'), archive);
  verifyArchive(archive, root);
  put('resources/licenses/LICENSES.chromium.html', 'Wrong runtime notice');
  assert.throws(() => verifyArchive(archive, root), /Missing or changed Electron/);
  copyFileSync(path.join(root, 'node_modules/electron/dist/LICENSES.chromium.html'), path.join(root, 'resources/licenses/LICENSES.chromium.html'));
  rmSync(path.join(root, 'app/LICENSE'));
  await asar.createPackage(path.join(root, 'app'), archive);
  asar.uncache(archive);
  assert.throws(() => verifyArchive(archive, root), /Missing required notice LICENSE/);
});
