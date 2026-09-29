import test from 'node:test';
import assert from 'node:assert/strict';
import { fromEditable, toEditable, usesCrlf } from '../src/eol.js';

test('CRLF files round-trip through the editor unchanged', () => {
  const original = 'a\r\nb\r\n';
  assert.equal(usesCrlf(original), true);
  assert.equal(toEditable(original), 'a\nb\n');
  assert.equal(fromEditable(toEditable(original), true), original);
  assert.equal(fromEditable('a\nb\nnew line\n', true), 'a\r\nb\r\nnew line\r\n');
});

test('LF files are left alone', () => {
  assert.equal(usesCrlf('a\nb\n'), false);
  assert.equal(toEditable('a\nb\n'), 'a\nb\n');
  assert.equal(fromEditable('a\nb\n', false), 'a\nb\n');
});
