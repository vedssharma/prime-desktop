import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { ACCENTS, DEFAULT_APPEARANCE, parseHex, type Appearance } from './appearance';

export default function AppearanceSettings({ appearance, onChange, onClose, storageError }: {
  appearance: Appearance; onChange: (value: Appearance) => void; onClose: () => void; storageError: boolean;
}) {
  const [hex, setHex] = useState(appearance.accent);
  const [error, setError] = useState('');
  useEffect(() => { setHex(appearance.accent); setError(''); }, [appearance.accent]);
  function commitHex() {
    const value = parseHex(hex);
    if (!value) { setError('Enter a six-digit hex color, such as #5799ed.'); return; }
    setError(''); setHex(value); onChange({ ...appearance, accent: value });
  }
  return <div className="appearance-settings">
    <h2 id="dialog-title">Settings</h2>
    <h3>Appearance</h3>
    <p>Make Session Dock your own. Changes apply instantly and stay on this device.</p>
    <fieldset><legend>Theme</legend><div className="theme-options">
      {([{ value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }, { value: 'system', label: 'System', Icon: Monitor }] as const).map(({ value, label, Icon }) =>
        <label className="theme-option" key={value}><input type="radio" name="theme" aria-label={label} value={value} checked={appearance.theme === value} onChange={() => onChange({ ...appearance, theme: value })} /><Icon size={19} /><span>{label}</span></label>)}
    </div></fieldset>
    <fieldset><legend>Palette</legend><div className="palette-options">
      {([{ value: 'stone', label: 'Stone', detail: 'Soft and natural' }, { value: 'slate', label: 'Slate', detail: 'Cool and focused' }, { value: 'sand', label: 'Sand', detail: 'Warm and calm' }] as const).map(({ value, label, detail }) =>
        <label className="palette-option" key={value} data-palette-option={value}><input type="radio" name="palette" value={value} checked={appearance.palette === value} aria-label={label} onChange={() => onChange({ ...appearance, palette: value })} /><span className="palette-sample" aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span></label>)}
    </div></fieldset>
    <fieldset><legend>Accent color</legend><div className="accent-options">
      {ACCENTS.map(({ name, value }) => <button key={name} type="button" className="accent-swatch" aria-label={`${name} accent`} aria-pressed={appearance.accent === value} title={name} style={{ backgroundColor: value }} onClick={() => { setError(''); setHex(value); onChange({ ...appearance, accent: value }); }} />)}
    </div><div className="custom-accent"><label>Custom color<input type="color" aria-label="Custom accent color" value={appearance.accent} onChange={event => onChange({ ...appearance, accent: event.target.value })} /></label><label>Hex value<input type="text" aria-label="Accent hex value" value={hex} maxLength={7} spellCheck={false} autoComplete="off" aria-invalid={!!error} aria-describedby={error ? 'accent-error' : 'accent-hint'} onChange={event => { setHex(event.target.value); setError(''); }} onBlur={commitHex} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitHex(); } }} /></label></div>
      {error && <p id="accent-error" className="settings-error" role="alert">{error}</p>}
      <p id="accent-hint" className="settings-hint">Text and focus colors adapt to keep your accent readable.</p>
    </fieldset>
    <div className="settings-preview" aria-label="Appearance preview"><div><strong>Your workspace, your style.</strong><p>Colors apply to conversations, tools, and controls.</p></div><span className="preview-accent">Accent</span></div>
    {storageError && <p className="settings-error" role="alert">Appearance changed for this window, but could not be saved. Local storage is unavailable.</p>}
    <div className="settings-footer"><button type="button" className="secondary-button" onClick={() => { setHex(DEFAULT_APPEARANCE.accent); setError(''); onChange({ ...DEFAULT_APPEARANCE }); }}>Reset appearance</button><button type="button" className="primary-button" onClick={onClose}>Done</button></div>
  </div>;
}
