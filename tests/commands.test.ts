import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCommands, scoreCommand, type Command } from '../src/commands.js';

const make = (id: string, label: string, extra: Partial<Command> = {}): Command => ({ id, label, group: 'Actions', run: () => {}, ...extra });

test('an empty query keeps the original order', () => {
  const list = [make('a', 'Zed'), make('b', 'Alpha')];
  assert.deepEqual(filterCommands(list, '  ').map(c => c.id), ['a', 'b']);
});

test('prefix beats word start beats substring beats keywords beats loose letters', () => {
  const list = [
    make('sub', 'Resettings'), make('word', 'Open settings'), make('prefix', 'Settings'),
    make('kw', 'Preferences', { keywords: 'settings' }), make('loose', 'Some extra tools ignoring gaps'),
  ];
  assert.deepEqual(filterCommands(list, 'sett').map(c => c.id), ['prefix', 'word', 'sub', 'kw', 'loose']);
  assert.deepEqual(filterCommands(list, 'xtg').map(c => c.id), ['loose']);
});

test('non-matching commands are excluded and ties keep their order', () => {
  const list = [make('a', 'Alpha one'), make('b', 'Alpha two'), make('c', 'Beta')];
  assert.deepEqual(filterCommands(list, 'alpha').map(c => c.id), ['a', 'b']);
  assert.equal(scoreCommand(make('x', 'Nothing'), 'zzz'), 0);
});

test('session detail (workspace) is searchable', () => {
  const list = [make('s', 'Fix login', { group: 'Sessions', detail: '/work/webapp' })];
  assert.equal(filterCommands(list, 'webapp').length, 1);
});
