import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPreferences, savePreferences } from '../src/preferences.js';

test('preferences are validated and storage failures do not break startup', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; },
  } });
  try {
    assert.deepEqual(loadPreferences(), { cwd: '', model: '' });
    savePreferences({ cwd: '/tmp/project', model: 'provider/org/model' });
    assert.deepEqual(loadPreferences(), { cwd: '/tmp/project', model: 'provider/org/model' });
    assert.deepEqual(Object.keys(JSON.parse(stored!)).sort(), ['cwd', 'model']);
    for (const invalid of ['{', 'null', 'true', '[]']) {
      stored = invalid; assert.deepEqual(loadPreferences(), { cwd: '', model: '' });
    }
    stored = JSON.stringify({ cwd: 5, model: 'x'.repeat(513) });
    assert.deepEqual(loadPreferences(), { cwd: '', model: '' });
    stored = JSON.stringify({ cwd: '/tmp/\0bad', model: 'valid' });
    assert.deepEqual(loadPreferences(), { cwd: '', model: 'valid' });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
    assert.deepEqual(loadPreferences(), { cwd: '', model: '' });
    assert.doesNotThrow(() => savePreferences({ cwd: '/tmp', model: '' }));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
