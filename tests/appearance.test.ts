import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS, APPEARANCE_KEY, DEFAULT_APPEARANCE, contrastRatio, foregroundFor, loadAppearance, normalizeAppearance, parseHex, readableAccent, saveAppearance } from '../src/appearance.js';

test('appearance values are allowlisted and hex input is normalized', () => {
  assert.equal(parseHex(' FF88AA '), '#ff88aa');
  assert.equal(parseHex('#aBc123'), '#abc123');
  for (const input of ['red', '#fff', '#ffffffff', '#gg0000', 'url(x)', '']) assert.equal(parseHex(input), null);
  for (const input of [null, [], true, 2, 'dark', { theme: ['dark'], palette: ['sand'] }, { theme: 'bad', palette: 'bad', accent: 'bad' }]) assert.deepEqual(normalizeAppearance(input), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ theme: 'dark', palette: 'sand', accent: '5799ED', ignored: 'secret' }), { theme: 'dark', palette: 'sand', accent: '#5799ed' });
});

test('accent text maintains WCAG AA contrast across extremes and palette backgrounds', () => {
  const accents = [...ACCENTS.map(a => a.value), '#ffffff', '#000000', '#777777', '#808080', '#ff0000', '#00ff00', '#0000ff'];
  const backgrounds = ['#f7f7f5', '#f5f7fa', '#faf7f1', '#191918', '#171c24', '#211e19', '#242423', '#202630', '#29251f', '#141413', '#11161e', '#191610'];
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  for (const accent of accents) {
    assert(contrastRatio(accent, foregroundFor(accent)) >= 4.5, `button ${accent}`);
    for (const background of backgrounds) assert(contrastRatio(readableAccent(accent, background), background) >= 4.5, `${accent} on ${background}`);
  }
});

test('appearance storage is isolated from workspaces and tolerates unavailable storage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let value: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => { assert.equal(key, APPEARANCE_KEY); return value; },
    setItem: (key: string, next: string) => { assert.equal(key, APPEARANCE_KEY); value = next; },
  } });
  try {
    assert.deepEqual(loadAppearance(), DEFAULT_APPEARANCE);
    assert.equal(saveAppearance({ theme: 'dark', palette: 'slate', accent: '#000000' }), true);
    assert.deepEqual(loadAppearance(), { theme: 'dark', palette: 'slate', accent: '#000000' });
    value = '{'; assert.deepEqual(loadAppearance(), DEFAULT_APPEARANCE);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked'); } });
    assert.deepEqual(loadAppearance(), DEFAULT_APPEARANCE);
    assert.equal(saveAppearance({ ...DEFAULT_APPEARANCE }), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});


test('accent adjustment meets contrast on all surfaces in a theme, not just canvas', () => {
  const surfaces = [['#191918', '#242423', '#2c2c29', '#363632'], ['#171c24', '#222a35', '#2b3542', '#354152'], ['#211e19', '#2b2721', '#363027', '#433a2d'], ['#f7f7f5', '#ffffff', '#eeefeb', '#e6e7e2'], ['#f5f7fa', '#ffffff', '#eaf0f5', '#dee6ef'], ['#faf7f1', '#fffdf9', '#f0eae0', '#e9dfd0']];
  for (const accent of [...ACCENTS.map(a => a.value), '#ffffff', '#000000', '#777777']) {
    for (const [canvas, ...other] of surfaces) {
      const adjusted = readableAccent(accent, canvas, other);
      for (const base of [canvas, ...other]) assert(contrastRatio(adjusted, base) >= 4.5);
    }
  }
});


test('black or white button labels pass AA for every grayscale accent', () => {
  for (let value = 0; value <= 255; value++) {
    const accent = '#' + value.toString(16).padStart(2, '0').repeat(3);
    assert(contrastRatio(accent, foregroundFor(accent)) >= 4.5, accent);
  }
});
