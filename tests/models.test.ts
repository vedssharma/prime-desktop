import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrimeService } from '../electron/prime.js';
test('model discovery refreshes after empty catalog and rejects unexpected output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'models-'));
  const file = join(dir, 'catalog'); const cli = join(dir, 'cli');
  await writeFile(cli, `#!${process.execPath}\nprocess.stdout.write(require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8'));\n`);
  await chmod(cli, 0o700);
  const service = new PrimeService({ executable: cli });
  try {
    await writeFile(file, 'No models configured'); assert.deepEqual(await service.listModels(), []);
    await writeFile(file, 'provider model 128K 10K'); assert.deepEqual(await service.listModels(), [{ id: 'provider/model', name: 'model · provider' }]);
    await writeFile(file, 'Authentication failed'); await assert.rejects(service.listModels(), /Unrecognized/);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});
