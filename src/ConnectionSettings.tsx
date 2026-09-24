import { useEffect, useState } from 'react';
export default function ConnectionSettings({ onConnect }: { onConnect: () => Promise<void> }) {
  const [config, setConfig] = useState({ executable: '', socketPath: '' });
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (window.prime.getConnectionConfig) void window.prime.getConnectionConfig().then(setConfig).catch(error => setMessage(String(error))); }, []);
  return <details className="connection-settings"><summary>Connection &amp; setup</summary>
    <p>Install Prime Agent, then run <code>prime-agent</code> in a terminal. Use <code>/login</code> and <code>/model</code> there to configure a provider. This app never stores API keys.</p>
    <p>Use default discovery or enter absolute paths for a custom installation. Changes reconnect only this desktop; running CLI sessions are not stopped.</p>
    <label>CLI executable<input aria-label="CLI executable" value={config.executable} placeholder="Auto-detect prime-agent" onChange={e => setConfig({ ...config, executable: e.target.value })} /></label>
    <label>Daemon socket<input aria-label="Daemon socket" value={config.socketPath} placeholder="Default local socket" onChange={e => setConfig({ ...config, socketPath: e.target.value })} /></label>
    <button type="button" className="secondary-button" disabled={pending} onClick={async () => { setPending(true); setMessage(''); try { await window.prime.configureConnection(config); await onConnect(); setMessage('Connection settings saved. Check the connection status.'); } catch (error) { setMessage(String(error)); } finally { setPending(false); } }}>{pending ? 'Connecting…' : 'Save & reconnect'}</button>
    {message && <p role="status">{message}</p>}
  </details>;
}
