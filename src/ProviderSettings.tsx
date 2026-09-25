import { useEffect, useRef, useState } from 'react';
import type { ModelOption } from '../shared/types';

type ProviderSettingsProps = { onModelsChanged: (models: ModelOption[]) => void };

function ProviderCatalog({ onModelsChanged }: ProviderSettingsProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [copyError, setCopyError] = useState('');
  const [copyPending, setCopyPending] = useState(false);
  const onChanged = useRef(onModelsChanged);
  onChanged.current = onModelsChanged;

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    setError('');
    void window.prime.listModels().then(choices => {
      if (cancelled) return;
      setModels(choices);
      onChanged.current(choices);
    }).catch(() => {
      if (!cancelled) setError('Could not load models. Start prime-agent in a terminal, check the app connection, then choose Refresh models.');
    }).finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; };
  }, [revision]);

  async function copyCommand(command: string) {
    setCopyPending(true);
    setCopyMessage('');
    setCopyError('');
    try {
      await window.prime.copyText(command);
      setCopyMessage(`Copied ${command}. Paste it into ${command === 'prime-agent' ? 'your terminal' : 'the Prime Agent CLI'}.`);
    } catch {
      setCopyError(`Could not copy. Type ${command} into ${command === 'prime-agent' ? 'your terminal' : 'the Prime Agent CLI'} instead.`);
    } finally { setCopyPending(false); }
  }

  const groups = new Map<string, ModelOption[]>();
  for (const model of models) {
    const slash = model.id.indexOf('/');
    const provider = slash > 0 ? model.id.slice(0, slash) : 'Other';
    const group = groups.get(provider) || [];
    group.push(model);
    groups.set(provider, group);
  }
  const search = query.trim().toLowerCase();
  const visibleGroups = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([provider, choices]) => ({
    provider,
    total: choices.length,
    choices: choices.filter(model => `${provider} ${model.id} ${model.name}`.toLowerCase().includes(search)),
  })).filter(group => group.choices.length > 0);

  return <div className="provider-content">
    <h3>Set up a provider in Prime Agent</h3>
    <p>Sign in through the CLI. Session Dock does not ask for or store provider API keys.</p>
    <ol className="provider-steps">
      <li>Open a terminal and run <code>prime-agent</code>.<button type="button" className="secondary-button" disabled={copyPending} onClick={() => void copyCommand('prime-agent')}>Copy launch command</button></li>
      <li>In Prime Agent, enter <code>/login</code> and follow its provider sign-in steps.<button type="button" className="secondary-button" disabled={copyPending} onClick={() => void copyCommand('/login')}>Copy login command</button></li>
      <li>After signing in, use <code>/model</code> in the CLI to choose a model. Then refresh the catalog here.</li>
    </ol>
    {copyMessage && <p role="status">{copyMessage}</p>}
    {copyError && <p className="settings-error" role="alert">{copyError}</p>}
    <div className="provider-toolbar"><h3>Models available</h3><button type="button" className="secondary-button" disabled={pending} onClick={() => { setPending(true); setRevision(value => value + 1); }}>{pending ? 'Loading models…' : 'Refresh models'}</button></div>
    <p className="settings-hint">This catalog reports model availability, not provider sign-in or credential validity.</p>
    {error && <p className="settings-error" role="alert">{error}{models.length > 0 && ' Showing the last loaded catalog.'}</p>}
    <label className="provider-search">Search available models<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Provider, name, or model ID" /></label>
    <p role="status">{pending ? 'Loading model catalog…' : `${models.length} ${models.length === 1 ? 'model' : 'models'} across ${groups.size} ${groups.size === 1 ? 'provider' : 'providers'}.`}</p>
    {!pending && !error && models.length === 0 && <p>No models available yet. Complete the CLI steps above, then choose Refresh models.</p>}
    {models.length > 0 && visibleGroups.length === 0 && <p>No models match your search.</p>}
    <div className="provider-catalog">{visibleGroups.map(({ provider, total, choices }) => <section className="provider-group" key={provider} aria-label={`${provider} models`}>
      <h4>{provider} <span className="provider-count">{total} {total === 1 ? 'model' : 'models'}</span></h4>
      <ul>{choices.map(model => <li key={model.id}><strong>{model.name}</strong><code>{model.id}</code></li>)}</ul>
    </section>)}</div>
  </div>;
}

export default function ProviderSettings({ onModelsChanged }: ProviderSettingsProps) {
  const [open, setOpen] = useState(false);
  return <details className="provider-settings" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Providers &amp; models</summary>
    {open && <ProviderCatalog onModelsChanged={onModelsChanged} />}
  </details>;
}
