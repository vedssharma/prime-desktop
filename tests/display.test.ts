import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_KEY, applyDisplay, loadDisplay } from '../src/DisplaySettings.js';

test('display preferences are allowlisted and fall back when storage is invalid or blocked', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const defaults = { textSize: 'standard', density: 'comfortable' };
  let stored: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => { assert.equal(key, DISPLAY_KEY); return stored; },
  } });
  try {
    assert.deepEqual(loadDisplay(), defaults);
    stored = JSON.stringify({ textSize: 'large', density: 'compact', extra: true });
    assert.deepEqual(loadDisplay(), { textSize: 'large', density: 'compact' });
    stored = JSON.stringify({ textSize: 'huge', density: ['compact'] });
    assert.deepEqual(loadDisplay(), defaults);
    for (const invalid of ['{', 'null', '"large"', '[]']) { stored = invalid; assert.deepEqual(loadDisplay(), defaults, invalid); }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
    assert.deepEqual(loadDisplay(), defaults);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('display preferences are applied as root data attributes for the stylesheet', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const dataset: Record<string, string> = {};
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset } } });
  try {
    applyDisplay({ textSize: 'large', density: 'compact' });
    assert.deepEqual(dataset, { textSize: 'large', density: 'compact' });
    applyDisplay({ textSize: 'standard', density: 'comfortable' });
    assert.deepEqual(dataset, { textSize: 'standard', density: 'comfortable' });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
