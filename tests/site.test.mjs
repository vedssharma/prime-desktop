import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ASSET_SUFFIXES, detectPlatform, pickAssets } from '../site/downloads.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const asset = (name) => ({ name, browser_download_url: `https://example.test/${name}`, size: 1 });

test('download page finds every installer the release workflow publishes', () => {
  // Fails if electron-builder's artifactName or targets change without updating the landing page.
  assert.equal(pkg.build.artifactName, 'Session-Dock-${version}-${os}-${arch}.${ext}');
  assert.deepEqual(pkg.build.mac.target, ['dmg', 'zip']);
  assert.deepEqual(pkg.build.linux.target, ['AppImage', 'deb']);
  const names = ['Session-Dock-0.1.0-mac-arm64.dmg', 'Session-Dock-0.1.0-mac-arm64.zip', 'Session-Dock-0.1.0-linux-amd64.deb', 'Session-Dock-0.1.0-linux-x86_64.AppImage', 'SHA256SUMS'];
  const links = pickAssets({ assets: names.map(asset) });
  assert.deepEqual(Object.keys(links).sort(), [...Object.keys(ASSET_SUFFIXES), 'sums'].sort());
  assert.equal(links.deb, 'https://example.test/Session-Dock-0.1.0-linux-amd64.deb');
});

test('download page ignores unrelated assets and missing releases', () => {
  assert.deepEqual(pickAssets({ assets: [asset('Session-Dock-0.1.0-mac-arm64.dmg.blockmap'), asset('latest-mac.yml')] }), {});
  assert.deepEqual(pickAssets(undefined), {});
});

test('download page highlights the visitor\'s platform', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Ubuntu; Linux x86_64)'), 'linux');
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14)'), null);
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), null);
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), null);
});

test('every download button falls back to the latest release page', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const buttons = [...html.matchAll(/data-asset="([^"]+)" href="([^"]+)"/g)];
  assert.deepEqual(buttons.map(([, key]) => key).sort(), ['appimage', 'deb', 'mac-dmg', 'mac-zip', 'sums']);
  for (const [, , href] of buttons) assert.equal(href, 'https://github.com/vedssharma/prime-desktop/releases/latest');
});
