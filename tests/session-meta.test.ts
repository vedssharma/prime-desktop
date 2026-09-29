import test from 'node:test';
import assert from 'node:assert/strict';
import { allTags, groupSessions, normalizeTags, setTags, togglePin, type SessionMeta } from '../src/sessionMeta.js';
import type { Session } from '../shared/types.js';

const now = Date.parse('2024-06-15T12:00:00');
const make = (id: string, cwd: string, updatedAt: string, title = id): Session => ({ id, title, cwd, model: '', status: 'idle', createdAt: updatedAt, updatedAt });
const sessions = [
  make('a', '/w/app', '2024-06-15T11:00:00'), make('b', '/w/lib', '2024-06-12T11:00:00'), make('c', '/w/app', '2024-05-01T11:00:00'),
];
const meta = (extra: Partial<SessionMeta> = {}): SessionMeta => ({ pinned: [], tags: {}, groupBy: 'date', ...extra });
const names = (groups: [string, Session[]][]) => groups.map(([label, list]) => `${label}:${list.map(s => s.id).join('')}`);

test('tags are trimmed, de-duplicated case-insensitively, bounded and split on commas or newlines', () => {
  assert.deepEqual(normalizeTags(' bug , Bug,\nfeature ,, '), ['bug', 'feature']);
  assert.equal(normalizeTags('x'.repeat(50))[0].length, 24);
  assert.equal(normalizeTags('a,b,c,d,e,f,g,h').length, 6);
});

test('date grouping and pinned-first ordering', () => {
  assert.deepEqual(names(groupSessions(sessions, { search: '', tag: '', meta: meta(), now })), ['Today:a', 'Previous 7 days:b', 'Earlier:c']);
  assert.deepEqual(names(groupSessions(sessions, { search: '', tag: '', meta: meta({ pinned: ['c'] }), now })), ['Pinned:c', 'Today:a', 'Previous 7 days:b']);
});

test('workspace grouping is alphabetical with pinned first', () => {
  assert.deepEqual(names(groupSessions(sessions, { search: '', tag: '', meta: meta({ groupBy: 'workspace', pinned: ['b'] }), now })), ['Pinned:b', 'app:ac']);
});

test('search matches tags and the tag filter is case-insensitive', () => {
  const m = setTags(meta(), 'b', ['Urgent']);
  assert.deepEqual(names(groupSessions(sessions, { search: 'urgent', tag: '', meta: m, now })), ['Previous 7 days:b']);
  assert.deepEqual(names(groupSessions(sessions, { search: '', tag: 'URGENT', meta: m, now })), ['Previous 7 days:b']);
  assert.deepEqual(groupSessions(sessions, { search: 'zzz', tag: '', meta: m, now }), []);
});

test('pin toggles, pins for missing sessions are ignored, and tag lists ignore deleted sessions', () => {
  assert.deepEqual(togglePin(togglePin(meta(), 'a'), 'a').pinned, []);
  assert.deepEqual(names(groupSessions(sessions, { search: '', tag: '', meta: meta({ pinned: ['gone'] }), now })), ['Today:a', 'Previous 7 days:b', 'Earlier:c']);
  const m = setTags(setTags(meta(), 'a', ['x']), 'gone', ['y']);
  assert.deepEqual(allTags(m, sessions), ['x']);
  assert.deepEqual(setTags(m, 'a', []).tags, { gone: ['y'] });
});
