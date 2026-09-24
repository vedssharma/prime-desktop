import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';
import { checkNotices, projectRoot } from './generate-notices.mjs';

export function verifyArchive(archive, root = projectRoot) {
  checkNotices(root);
  const required = new Map([
    ['LICENSE', 'LICENSE'],
    ['THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
    ['dist/notices.txt', 'public/notices.txt'],
    ['dist/licenses/dm-sans-OFL.txt', 'public/licenses/dm-sans-OFL.txt'],
    ['dist/licenses/space-grotesk-OFL.txt', 'public/licenses/space-grotesk-OFL.txt'],
  ]);
  for (const [entry, source] of required) {
    let contents;
    try { contents = asar.extractFile(archive, entry); }
    catch { throw new Error(`Missing required notice ${entry} in ${archive}`); }
    if (!contents.equals(readFileSync(path.join(root, source)))) {
      throw new Error(`License bytes differ: ${entry} in ${archive}`);
    }
  }
  for (const [entry, source] of [
    ['electron-LICENSE.txt', 'LICENSE'],
    ['LICENSES.chromium.html', 'LICENSES.chromium.html'],
  ]) {
    const filename = path.join(path.dirname(archive), 'licenses', entry);
    if (!existsSync(filename) || !readFileSync(filename).equals(readFileSync(path.join(root, 'node_modules/electron/dist', source)))) {
      throw new Error(`Missing or changed Electron runtime notice: ${filename}`);
    }
  }
  console.log(`Verified project, dependency, font, and Electron/Chromium notices: ${archive}`);
}

function findArchives(directory) {
  const archives = [];
  if (!existsSync(directory)) return archives;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) archives.push(...findArchives(filename));
    else if (entry.isFile() && entry.name === 'app.asar') archives.push(filename);
  }
  return archives;
}

// electron-builder calls this for each freshly packed target, before making its
// installer/archive. Missing notices therefore fail both package and dist.
export default async function afterPack(context) {
  const archives = findArchives(context.appOutDir);
  if (archives.length !== 1) throw new Error(`Expected one app.asar in ${context.appOutDir}, found ${archives.length}`);
  verifyArchive(archives[0]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(projectRoot, 'release');
  const archives = target.endsWith('.asar') ? [target] : findArchives(target);
  if (archives.length === 0) throw new Error(`No app.asar found in ${target}; run npm run package first.`);
  for (const archive of archives) verifyArchive(archive);
}
