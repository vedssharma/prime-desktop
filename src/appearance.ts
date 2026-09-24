export type ThemeMode = 'light' | 'dark' | 'system';
export type Palette = 'stone' | 'slate' | 'sand';
export interface Appearance { theme: ThemeMode; palette: Palette; accent: string; }
export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({ theme: 'system', palette: 'stone', accent: '#c0ee65' });
export const APPEARANCE_KEY = 'session-dock.appearance.v1';
export const ACCENTS = [
  { name: 'Lime', value: '#c0ee65' }, { name: 'Blue', value: '#5799ed' },
  { name: 'Violet', value: '#aa8cf2' }, { name: 'Rose', value: '#ee819d' },
  { name: 'Amber', value: '#efb64e' },
] as const;
export function parseHex(value: string): string | null {
  return /^#?[0-9a-f]{6}$/i.test(value.trim()) ? '#' + value.trim().replace(/^#/, '').toLowerCase() : null;
}
export function normalizeAppearance(value: unknown): Appearance {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    theme: typeof record.theme === 'string' && ['light', 'dark', 'system'].includes(record.theme) ? record.theme as ThemeMode : DEFAULT_APPEARANCE.theme,
    palette: typeof record.palette === 'string' && ['stone', 'slate', 'sand'].includes(record.palette) ? record.palette as Palette : DEFAULT_APPEARANCE.palette,
    accent: typeof record.accent === 'string' ? parseHex(record.accent) ?? DEFAULT_APPEARANCE.accent : DEFAULT_APPEARANCE.accent,
  };
}
export function loadAppearance(): Appearance {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || 'null')); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}
export function saveAppearance(value: Appearance): boolean {
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(normalizeAppearance(value))); return true; }
  catch { return false; }
}
function rgb(hex: string): number[] { return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)); }
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export function foregroundFor(background: string): string {
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
}
/** Preserve the hue when possible, but prioritize readable small text. */
export function readableAccent(accent: string, background: string, additional: string[] = []): string {
  const backgrounds = [background, ...additional];
  const readable = (value: string) => backgrounds.every(base => contrastRatio(value, base) >= 4.5);
  if (readable(accent)) return accent;
  const destination = foregroundFor(background);
  const from = rgb(accent), to = rgb(destination);
  for (let step = 1; step <= 100; step++) {
    const hex = '#' + from.map((c, i) => Math.round(c + (to[i] - c) * step / 100).toString(16).padStart(2, '0')).join('');
    if (readable(hex)) return hex;
  }
  return destination;
}
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  const dark = appearance.theme === 'dark' || appearance.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.palette = appearance.palette;
  root.style.colorScheme = dark ? 'dark' : 'light';
  const computed = getComputedStyle(root);
  const canvas = parseHex(computed.getPropertyValue('--canvas').trim()) ?? (dark ? '#181c19' : '#f8f9f5');
  const sidebar = parseHex(computed.getPropertyValue('--sidebar').trim()) ?? '#20231f';
  const backgrounds = (names: string[]) => names.map(name => parseHex(computed.getPropertyValue(name).trim())).filter((color): color is string => !!color);
  const surfaces = backgrounds(['--surface', '--surface-subtle', '--surface-hover']);
  const sidebarSurfaces = backgrounds(['--sidebar-surface', '--sidebar-hover']);
  root.style.setProperty('--accent', appearance.accent);
  root.style.setProperty('--on-accent', foregroundFor(appearance.accent));
  root.style.setProperty('--accent-text', readableAccent(appearance.accent, canvas, surfaces));
  root.style.setProperty('--accent-sidebar', readableAccent(appearance.accent, sidebar, sidebarSurfaces));
  root.style.setProperty('--focus', readableAccent(appearance.accent, canvas, surfaces));
}
