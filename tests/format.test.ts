import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { errorText, folderName, messageTime, relativeTime, toolPreview } from '../src/format.js';

test('folder names come from the last path segment on POSIX and Windows paths', () => {
  assert.equal(folderName('/Users/me/project'), 'project');
  assert.equal(folderName('/Users/me/project/'), 'project');
  assert.equal(folderName('C:\\Users\\me\\repo\\'), 'repo');
  assert.equal(folderName('relative'), 'relative');
  assert.equal(folderName('/'), '/');
  assert.equal(folderName(''), 'Choose a folder');
});

test('relative times round down to minutes, hours and days and never go negative', () => {
  const now = Date.parse('2024-06-15T12:00:00Z');
  mock.method(Date, 'now', () => now);
  try {
    const ago = (ms: number) => relativeTime(new Date(now - ms).toISOString());
    const minute = 60_000, hour = 60 * minute, day = 24 * hour;
    assert.equal(ago(59_999), 'now');
    assert.equal(ago(-day), 'now');
    assert.equal(ago(minute), '1m');
    assert.equal(ago(hour - 1), '59m');
    assert.equal(ago(hour), '1h');
    assert.equal(ago(day - 1), '23h');
    assert.equal(ago(day), '1d');
    assert.equal(ago(45 * day), '45d');
  } finally { mock.restoreAll(); }
});

test('message times add the date for earlier days and the year for earlier years', () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2024, 5, 15, 18, 30) });
  try {
    const today = messageTime(new Date(2024, 5, 15, 9, 5).toISOString());
    assert.doesNotMatch(today, /,/);
    assert.equal(today, new Date(2024, 5, 15, 9, 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const earlier = messageTime(new Date(2024, 5, 14, 9, 5).toISOString());
    assert.ok(earlier.endsWith(`, ${today}`), earlier);
    assert.doesNotMatch(earlier, /2024/);
    assert.match(messageTime(new Date(2023, 5, 15, 9, 5).toISOString()), /2023/);
  } finally { mock.timers.reset(); }
});

test('error text prefers the Error message and stringifies anything else', () => {
  assert.equal(errorText(new Error('Boom')), 'Boom');
  assert.equal(errorText('plain'), 'plain');
  assert.equal(errorText(42), '42');
  assert.equal(errorText(undefined), 'undefined');
});

test('tool previews use the first non-empty line and are shortened', () => {
  assert.equal(toolPreview('\n  \n  npm test  \nsecond'), 'npm test');
  assert.equal(toolPreview(''), '');
  assert.equal(toolPreview('x'.repeat(200), 10), 'xxxxxxxxx…');
});
