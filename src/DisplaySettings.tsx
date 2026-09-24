import { useState } from 'react';
export const DISPLAY_KEY = 'session-dock.display.v1';
export interface DisplayPreferences { textSize: 'standard' | 'large'; density: 'comfortable' | 'compact'; }
export function loadDisplay(): DisplayPreferences {
  try { const value = JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}'); return { textSize: value?.textSize === 'large' ? 'large' : 'standard', density: value?.density === 'compact' ? 'compact' : 'comfortable' }; }
  catch { return { textSize: 'standard', density: 'comfortable' }; }
}
export function applyDisplay(value: DisplayPreferences) {
  document.documentElement.dataset.textSize = value.textSize;
  document.documentElement.dataset.density = value.density;
}
export default function DisplaySettings() {
  const [value, setValue] = useState(loadDisplay);
  const [error, setError] = useState(false);
  const change = (next: DisplayPreferences) => { setValue(next); applyDisplay(next); try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(next)); setError(false); } catch { setError(true); } };
  return <section className="display-settings"><h3>Readability</h3>
    <label>Text size<select aria-label="Text size" value={value.textSize} onChange={event => change({ ...value, textSize: event.target.value as DisplayPreferences['textSize'] })}><option value="standard">Standard</option><option value="large">Large</option></select></label>
    <label>Density<select aria-label="Density" value={value.density} onChange={event => change({ ...value, density: event.target.value as DisplayPreferences['density'] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
    {error && <p role="alert">Readability changed, but could not be saved.</p>}
  </section>;
}
