import test from 'node:test';
import assert from 'node:assert/strict';
import { VERIFIED_OWNED_VERSIONS, isVerifiedOwnedVersion, parseCliVersion, parseCliVersions, verifiedVersionsText } from '../electron/cli-versions.js';

test('CLI version output is parsed from common formats without partial matches', () => {
  assert.equal(parseCliVersion('0.9.6\n'), '0.9.6');
  assert.equal(parseCliVersion('prime-agent 0.9.6'), '0.9.6');
  assert.equal(parseCliVersion('prime-agent v0.9.6 (darwin-arm64)'), '0.9.6');
  assert.equal(parseCliVersion('node 22.12.0\nprime-agent 0.9.6'), '0.9.6', 'a verified version anywhere in the output wins');
  assert.equal(parseCliVersion('prime-agent 0.10.0-beta.1'), '0.10.0-beta.1');
  assert.deepEqual(parseCliVersions('0.9.60 10.9.6 1.2'), ['0.9.60', '10.9.6']);
  assert.equal(parseCliVersion('no version here'), undefined);
});

test('only reviewed versions enable desktop-owned sessions', () => {
  assert.deepEqual(VERIFIED_OWNED_VERSIONS, ['0.9.6']);
  assert.equal(isVerifiedOwnedVersion('0.9.6'), true);
  for (const version of ['0.9.5', '0.9.60', '10.9.6', '0.9.6-rc.1', undefined]) assert.equal(isVerifiedOwnedVersion(version), false, String(version));
  assert.equal(verifiedVersionsText(), '0.9.6');
});
