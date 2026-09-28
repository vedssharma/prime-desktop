import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile } from 'node:fs/promises';
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

test('concurrent model requests share one CLI run and colored or header-only catalogs parse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'models-'));
  const file = join(dir, 'catalog'); const runs = join(dir, 'runs'); const cli = join(dir, 'cli');
  await writeFile(cli, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(runs)}, 'x');\nprocess.stdout.write(fs.readFileSync(${JSON.stringify(file)}, 'utf8'));\n`);
  await chmod(cli, 0o700);
  const service = new PrimeService({ executable: cli });
  try {
    await writeFile(file, '\x1b[1mprovider\x1b[0m  model   context  max-out\n\x1b[32manthropic\x1b[0m  big-model  1.5M  64K\nopenai  small  200K  16K\nnot a model row\n');
    const [first, second] = await Promise.all([service.listModels(), service.listModels()]);
    assert.equal(await readFile(runs, 'utf8'), 'x');
    assert.deepEqual(first, [{ id: 'anthropic/big-model', name: 'big-model · anthropic' }, { id: 'openai/small', name: 'small · openai' }]);
    assert.equal(second, first);
    await writeFile(file, 'provider  model  context  max-out\n');
    assert.deepEqual(await service.listModels(), []);
    assert.equal(await readFile(runs, 'utf8'), 'xx', 'a finished request is not cached');
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});
