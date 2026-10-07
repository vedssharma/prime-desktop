import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOffsets } from '../src/find.js';

test('find matches are case-insensitive, non-overlapping and empty for an empty query', () => {
  assert.deepEqual(matchOffsets('Retry, retry, RETRY', 'retry'), [0, 7, 14]);
  assert.deepEqual(matchOffsets('aaaa', 'aa'), [0, 2], 'matches do not overlap');
  assert.deepEqual(matchOffsets('nothing here', 'absent'), []);
  assert.deepEqual(matchOffsets('text', ''), []);
  assert.deepEqual(matchOffsets('', 'x'), []);
});
