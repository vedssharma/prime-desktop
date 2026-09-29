import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedSessions, notificationFor } from '../src/notify.js';
import type { Session } from '../shared/types.js';

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
