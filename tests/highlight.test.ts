import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFor, languageForFile, tokenize } from '../src/highlight.js';

const kinds = (code: string, lang: string) => tokenize(code, lang).filter(t => t.kind !== 'plain').map(t => `${t.kind}:${t.text}`);

test('language comes from the Markdown class and resolves aliases; unknown languages are not highlighted', () => {
  assert.equal(languageFor('language-typescript'), 'ts');
  assert.equal(languageFor('foo language-bash'), 'sh');
  assert.equal(languageFor('language-brainfuck'), undefined);
  assert.equal(languageFor(undefined), undefined);
});

test('tokens classify keywords, strings, numbers and comments', () => {
  assert.deepEqual(kinds('const a = "x"; // hi\nreturn 42', 'js'), ['keyword:const', 'string:"x"', 'comment:// hi', 'keyword:return', 'number:42']);
  assert.deepEqual(kinds('def f(): # note\n  return None', 'py'), ['keyword:def', 'comment:# note', 'keyword:return', 'keyword:None']);
});

test('keywords inside strings and comments stay part of those tokens', () => {
  assert.deepEqual(kinds('"if" /* for */', 'js'), ['string:"if"', 'comment:/* for */']);
});

test('tokens always reassemble to the exact input, including unterminated strings', () => {
  for (const [code, lang] of [['let s = "open\nx', 'js'], ['a\n/* never closed', 'js'], ['SELECT 1 -- c', 'sql'], ['<b>&</b>', 'js']] as const)
    assert.equal(tokenize(code, lang).map(t => t.text).join(''), code);
});

test('very large blocks are left plain to bound rendering cost', () => {
  assert.equal(tokenize('const a = 1;'.repeat(5000), 'js').length, 1);
});

test('file names map to languages by extension', () => {
  assert.equal(languageForFile('src/App.tsx'), 'ts');
  assert.equal(languageForFile('run.SH'), 'sh');
  assert.equal(languageForFile('README'), undefined);
  assert.equal(languageForFile('data.unknown'), undefined);
});
