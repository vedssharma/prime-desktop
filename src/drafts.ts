/**
 * Opt-in persistence for unsent draft text. Off by default: prompts can be private, so they stay in
 * memory unless the user chooses otherwise. Images are never saved.
 */
export const KEEP_DRAFTS_KEY = 'session-dock.keep-drafts.v1';
export const DRAFTS_KEY = 'session-dock.drafts.v1';
const MAX_DRAFTS = 50;
const MAX_DRAFT_CHARS = 64 * 1024;
const MAX_KEY_CHARS = 4096;

export function loadKeepDrafts(): boolean {
  try { return localStorage.getItem(KEEP_DRAFTS_KEY) === 'on'; } catch { return false; }
}
/** Turning the setting off also deletes any saved draft text. */
export function saveKeepDrafts(enabled: boolean): boolean {
  try {
    localStorage.setItem(KEEP_DRAFTS_KEY, enabled ? 'on' : 'off');
    if (!enabled) localStorage.removeItem(DRAFTS_KEY);
    return true;
  } catch { return false; }
}
export function loadSavedDrafts(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const drafts: Record<string, string> = {};
    for (const [key, text] of Object.entries(value).slice(0, MAX_DRAFTS)) {
      if (typeof text === 'string' && text && text.length <= MAX_DRAFT_CHARS && key.length <= MAX_KEY_CHARS) drafts[key] = text;
    }
    return drafts;
  } catch { return {}; }
}
/** Saves non-empty draft text only, within the same bounds the loader accepts. */
export function saveDrafts(drafts: Record<string, { text: string }>): boolean {
  const kept = Object.fromEntries(Object.entries(drafts)
    .filter(([key, entry]) => entry.text.trim() && entry.text.length <= MAX_DRAFT_CHARS && key.length <= MAX_KEY_CHARS)
    .slice(0, MAX_DRAFTS).map(([key, entry]) => [key, entry.text]));
  try {
    if (Object.keys(kept).length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(kept)); else localStorage.removeItem(DRAFTS_KEY);
    return true;
  } catch { return false; }
}
