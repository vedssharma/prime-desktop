import test from 'node:test';
import assert from 'node:assert/strict';
import { releasePolicy } from '../scripts/release-policy.mjs';
test('unsigned releases cannot inherit signing identities or notarization credentials', () => {
  const input = { PATH: '/bin', CSC_NAME: 'Developer', CSC_LINK: 'secret', CSC_KEY_PASSWORD: 'secret', APPLE_ID: 'secret', APPLE_API_KEY: 'secret', WIN_CSC_LINK: 'secret' };
  const policy = releasePolicy(false, 'darwin', input);
  assert.deepEqual(policy.env, { PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert(policy.args.includes('--config.mac.identity=-')); assert(policy.args.includes('--config.mac.hardenedRuntime=false')); assert(policy.args.includes('--config.mac.notarize=false'));
  assert.equal(input.CSC_NAME, 'Developer');
});
test('signed releases require credentials and override disabled discovery', () => {
  assert.throws(() => releasePolicy(true, 'darwin', {}), /requires CSC_LINK/);
  const policy = releasePolicy(true, 'darwin', { CSC_LINK: 'certificate', CSC_KEY_PASSWORD: 'password', APPLE_ID: 'id', APPLE_APP_SPECIFIC_PASSWORD: 'password', APPLE_TEAM_ID: 'team', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert.equal(policy.env.CSC_IDENTITY_AUTO_DISCOVERY, 'true'); assert(policy.args.includes('--config.forceCodeSigning=true'));
  assert.throws(() => releasePolicy(false, 'win32', {}), /unsupported/);
});
test('Linux releases are unsigned only and strip every signing and notarization variable', () => {
  const policy = releasePolicy(false, 'linux', { PATH: '/bin', CSC_LINK: 'secret', WIN_CSC_KEY_PASSWORD: 'secret', APPLE_TEAM_ID: 'team', NOTARIZE_TOOL: 'x', MY_CSC_LINK: 'kept' });
  assert.deepEqual(policy.env, { PATH: '/bin', MY_CSC_LINK: 'kept', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert.deepEqual(policy.args, ['--config.forceCodeSigning=false']);
  assert.throws(() => releasePolicy(true, 'linux', { CSC_LINK: 'c', CSC_KEY_PASSWORD: 'p', APPLE_ID: 'i', APPLE_APP_SPECIFIC_PASSWORD: 'p', APPLE_TEAM_ID: 't' }), /macOS only/);
  for (const key of ['CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    const env = { CSC_LINK: 'c', CSC_KEY_PASSWORD: 'p', APPLE_ID: 'i', APPLE_APP_SPECIFIC_PASSWORD: 'p', APPLE_TEAM_ID: 't', [key]: '' };
    assert.throws(() => releasePolicy(true, 'darwin', env), new RegExp(`requires ${key}`));
  }
});
test('release tags must match the package version, and prereleases are recognized', async () => {
  const { checkReleaseTag } = await import('../scripts/release-tag.mjs');
  assert.deepEqual(checkReleaseTag('v0.2.0', '0.2.0'), { version: '0.2.0', prerelease: false });
  assert.deepEqual(checkReleaseTag('v1.0.0-beta.1', '1.0.0-beta.1'), { version: '1.0.0-beta.1', prerelease: true });
  assert.throws(() => checkReleaseTag('v0.2.1', '0.2.0'), /tag the release as v0\.2\.0/);
  assert.throws(() => checkReleaseTag('0.2.0', '0.2.0'), /does not match/);
  assert.throws(() => checkReleaseTag('v0.2', '0.2'), /not a release version/);
  assert.throws(() => checkReleaseTag('v', undefined), /not a release version/);
});
