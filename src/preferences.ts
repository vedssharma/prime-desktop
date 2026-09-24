export interface Preferences { cwd: string; model: string; }
const KEY = 'prime-desktop.preferences.v1';
export function loadPreferences(): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!value || typeof value !== 'object') return { cwd: '', model: '' };
    const record = value as Record<string, unknown>;
    return {
      cwd: typeof record.cwd === 'string' && record.cwd.length <= 4096 && !record.cwd.includes('\0') ? record.cwd : '',
      model: typeof record.model === 'string' && record.model.length <= 512 && !record.model.includes('\0') ? record.model : '',
    };
  } catch { return { cwd: '', model: '' }; }
}
export function savePreferences(preferences: Preferences): void {
  // Never persist prompts, transcripts, or credentials in renderer storage.
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Storage may be unavailable. */ }
}
