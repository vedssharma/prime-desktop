import test from 'node:test';
import assert from 'node:assert/strict';
import { releasePolicy } from '../scripts/release-policy.mjs';
test('unsigned releases cannot inherit signing identities or notarization credentials', () => {
  const input = { PATH: '/bin', CSC_NAME: 'Developer', CSC_LINK: 'secret', CSC_KEY_PASSWORD: 'secret', APPLE_ID: 'secret', APPLE_API_KEY: 'secret', WIN_CSC_LINK: 'secret' };
  const policy = releasePolicy(false, 'darwin', input);
  assert.deepEqual(policy.env, { PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert(policy.args.includes('--config.mac.identity=null')); assert(policy.args.includes('--config.mac.notarize=false'));
  assert.equal(input.CSC_NAME, 'Developer');
});
test('signed releases require credentials and override disabled discovery', () => {
  assert.throws(() => releasePolicy(true, 'darwin', {}), /requires CSC_LINK/);
  const policy = releasePolicy(true, 'darwin', { CSC_LINK: 'certificate', CSC_KEY_PASSWORD: 'password', APPLE_ID: 'id', APPLE_APP_SPECIFIC_PASSWORD: 'password', APPLE_TEAM_ID: 'team', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert.equal(policy.env.CSC_IDENTITY_AUTO_DISCOVERY, 'true'); assert(policy.args.includes('--config.forceCodeSigning=true'));
  assert.throws(() => releasePolicy(false, 'win32', {}), /unsupported/);
});
