import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releasePolicy } from './release-policy.mjs';

const signed = process.argv.includes('--signed');
const policy = releasePolicy(signed, process.platform, process.env);
const run = (command, args) => { const result = spawnSync(command, args, { stdio: 'inherit', env: policy.env }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(`${command} failed (${result.status})`); };
const oldArtifacts = await readdir('release').catch(() => []);
if (oldArtifacts.some(name => /\.(dmg|zip|AppImage)$/.test(name))) throw new Error('Existing release archives found. Move them elsewhere before making a release; refusing stale checksums.');
run('npm', ['run', 'dist', '--', ...policy.args]);
// A private, gated build; this script never uploads/publishes a GitHub release.
const artifacts = (await readdir('release')).filter(name => /\.(dmg|zip|AppImage)$/.test(name)).sort();
if (!artifacts.length) throw new Error('No release artifacts were generated');
const hashes = [];
for (const name of artifacts) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path.join('release', name))) hash.update(chunk); hashes.push(`${hash.digest('hex')}  ${name}`); }
await writeFile('release/SHA256SUMS', hashes.join('\n') + '\n');
console.log(`Prepared ${signed ? 'signed/notarized' : 'unsigned'} artifacts and SHA256SUMS. No release published.`);
