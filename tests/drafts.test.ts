import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFTS_KEY, KEEP_DRAFTS_KEY, loadKeepDrafts, loadSavedDrafts, saveDrafts, saveKeepDrafts } from '../src/drafts.js';

function withStorage(run: (store: Map<string, string>) => void, failing = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  const fail = () => { throw new Error('blocked'); };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: failing ? { getItem: fail, setItem: fail, removeItem: fail } : {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); },
  } });
  try { run(store); } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete (globalThis as { localStorage?: unknown }).localStorage; }
}

test('keeping drafts is off by default, and turning it off deletes saved text', () => withStorage(store => {
  assert.equal(loadKeepDrafts(), false);
  assert.equal(saveKeepDrafts(true), true);
  assert.equal(loadKeepDrafts(), true);
  saveDrafts({ s1: { text: 'unsent idea' } });
  assert.ok(store.has(DRAFTS_KEY));
  saveKeepDrafts(false);
  assert.equal(store.get(KEEP_DRAFTS_KEY), 'off');
  assert.equal(store.has(DRAFTS_KEY), false);
}));

test('only non-empty, bounded draft text is saved and loaded', () => withStorage(store => {
  saveDrafts({ keep: { text: 'hello' }, blank: { text: '   ' }, huge: { text: 'x'.repeat(64 * 1024 + 1) } });
  assert.deepEqual(loadSavedDrafts(), { keep: 'hello' });
  saveDrafts({ keep: { text: '' } });
  assert.equal(store.has(DRAFTS_KEY), false, 'clearing the last draft removes the stored record');
  store.set(DRAFTS_KEY, JSON.stringify({ ok: 'text', number: 5, empty: '' }));
  assert.deepEqual(loadSavedDrafts(), { ok: 'text' });
  store.set(DRAFTS_KEY, '[1,2]');
  assert.deepEqual(loadSavedDrafts(), {});
  store.set(DRAFTS_KEY, '{not json');
  assert.deepEqual(loadSavedDrafts(), {});
}));

test('blocked storage reports failure without throwing', () => withStorage(() => {
  assert.equal(loadKeepDrafts(), false);
  assert.equal(saveKeepDrafts(true), false);
  assert.equal(saveDrafts({ a: { text: 'x' } }), false);
  assert.deepEqual(loadSavedDrafts(), {});
}, true));
