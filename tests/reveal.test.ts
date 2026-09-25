import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRevealLength } from '../src/reveal.js';

test('reveal advances to a word boundary and never past the end', () => {
  const text = 'Hello **bold** world';
  assert.equal(nextRevealLength(text, 0, 2), 5);
  assert.equal(nextRevealLength(text, 5, 3), 14);
  assert.equal(nextRevealLength(text, 14, 100), text.length);
  assert.equal(nextRevealLength(text, 0, 0), 5);
});
