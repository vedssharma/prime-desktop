export function releasePolicy(signed, platform, source) {
  if (!['darwin', 'linux'].includes(platform)) throw new Error('Release support is limited to macOS and Linux; Windows daemon transport is unsupported.');
  const env = { ...source };
  if (signed) {
    if (platform !== 'darwin') throw new Error('Signed/notarized mode currently supports macOS only.');
    for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) if (!env[key]) throw new Error(`Signed release requires ${key}; refusing unsigned fallback.`);
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
    return { env, args: ['--config.forceCodeSigning=true', '--config.mac.notarize=true'] };
  }
  for (const key of Object.keys(env)) if (/^(?:CSC_|WIN_CSC_|APPLE_|NOTARIZE_)/.test(key)) delete env[key];
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  return { env, args: platform === 'darwin' ? ['--config.mac.identity=null', '--config.mac.notarize=false', '--config.forceCodeSigning=false'] : ['--config.forceCodeSigning=false'] };
}
