import { spawnSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifySignedApp(app, platform = process.platform, run = spawnSync) {
  if (platform !== 'darwin') throw Error('Signed release verification requires macOS.');
  const checked = (command, args) => {
    const result = run(command, args, {encoding:'utf8'});
    if (result.error || result.status !== 0) throw Error(`${command} verification failed; refusing signed artifacts.`);
    return (result.stdout ?? '') + (result.stderr ?? '');
  };
  checked('codesign', ['--verify','--deep','--strict',app]);
  const details = checked('codesign', ['--display','--verbose=4',app]);
  if (!/^Authority=Developer ID Application:/m.test(details) || !/^TeamIdentifier=[A-Z0-9]+$/m.test(details) || !/flags=.*\bruntime\b/.test(details)) throw Error('App must have a Developer ID identity, team, and hardened runtime.');
  checked('spctl', ['--assess','--type','execute',app]);
  checked('xcrun', ['stapler','validate',app]);
  return {developerId:true,hardenedRuntime:true,gatekeeper:true,stapled:true};
}

export async function verifySignedRelease(directory = 'release') {
  const appDirectories = (await readdir(directory)).filter(name=>/^mac(?:-|$)/.test(name));
  const apps = [];
  for (const name of appDirectories) for (const child of await readdir(path.join(directory,name))) if (child.endsWith('.app')) apps.push(path.join(directory,name,child));
  if (apps.length !== 1) throw Error('Expected exactly one packaged macOS app for signed release verification.');
  const checks = verifySignedApp(apps[0]);
  await writeFile(path.join(directory,'SIGNING_VERIFICATION.json'), JSON.stringify({app:path.relative(directory,apps[0]),checks},null,2)+'\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifySignedRelease(process.argv[2]);
