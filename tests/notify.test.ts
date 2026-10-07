import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFY_KEY, finishedSessions, loadNotify, notificationFor, saveNotify } from '../src/notify.js';
import type { Session } from '../shared/types.js';
import { withStorage } from './storage.js';

const make = (id: string, status: Session['status'], title = id): Session => ({ id, title, cwd: '/w', model: '', status, createdAt: '', updatedAt: '' });

test('only sessions that stop running are reported', () => {
  const previous = new Map<string, Session['status']>([['a', 'running'], ['b', 'running'], ['c', 'idle']]);
  const done = finishedSessions(previous, [make('a', 'idle'), make('b', 'running'), make('c', 'idle'), make('d', 'idle')]);
  assert.deepEqual(done.map(s => s.id), ['a']);
});

test('errors are reported and first sightings are never reported', () => {
  assert.deepEqual(finishedSessions(new Map([['a', 'running']]), [make('a', 'error')]).map(s => s.id), ['a']);
  assert.deepEqual(finishedSessions(new Map(), [make('a', 'idle')]), []);
});

test('notification text distinguishes errors and tolerates empty titles', () => {
  assert.equal(notificationFor(make('a', 'idle', 'Fix bug')).title, 'Session finished');
  assert.equal(notificationFor(make('a', 'error', '')).title, 'Session stopped with an error');
  assert.equal(notificationFor(make('a', 'idle', '')).body, 'Untitled session');
});

test('notifications are on by default, persist when turned off, and stay on when storage is blocked', () => {
  withStorage(store => {
    assert.equal(loadNotify(), true);
    assert.equal(saveNotify(false), true);
    assert.equal(store.get(NOTIFY_KEY), 'off');
    assert.equal(loadNotify(), false);
    assert.equal(saveNotify(true), true);
    assert.equal(loadNotify(), true);
    store.set(NOTIFY_KEY, 'unexpected');
    assert.equal(loadNotify(), true, 'only an explicit off disables notifications');
  });
  withStorage(() => {
    assert.equal(loadNotify(), true);
    assert.equal(saveNotify(false), false, 'a failed save is reported so the UI can say so');
  }, true);
});
