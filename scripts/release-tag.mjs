#!/usr/bin/env node
// A pushed release tag must name the version in package.json (v0.2.0 for "0.2.0"), so the
// installers, the About dialog and the GitHub release all agree on what is being shipped.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkReleaseTag(tag, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error(`package.json version "${version}" is not a release version.`);
  if (tag !== `v${version}`) throw new Error(`Tag "${tag}" does not match package.json version ${version}; tag the release as v${version}.`);
  return { version, prerelease: version.includes('-') };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const tag = (process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '').trim();
  const { version, prerelease } = checkReleaseTag(tag, JSON.parse(readFileSync('package.json', 'utf8')).version);
  console.log(`Releasing Session Dock ${version}${prerelease ? ' (prerelease)' : ''}.`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nprerelease=${prerelease}\n`);
  }
}
