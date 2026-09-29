import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { filterCommands, type Command } from './commands';

export default function CommandPalette({ commands, onPick }: { commands: Command[]; onPick: (command: Command) => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const results = useMemo(() => filterCommands(commands, query).slice(0, 50), [commands, query]);
  const selected = Math.min(index, Math.max(0, results.length - 1));
  const move = (delta: number) => setIndex(results.length ? (selected + delta + results.length) % results.length : 0);
  return <div className="palette">
    <h2 id="dialog-title" className="sr-only">Command palette</h2>
    <div className="palette-input"><Search size={15} aria-hidden="true" /><input role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[selected] ? `palette-${results[selected].id}` : undefined} aria-label="Search commands and sessions" placeholder="Type a command or session name…" autoFocus value={query}
      onChange={event => { setQuery(event.target.value); setIndex(0); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
        else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (results[selected]) onPick(results[selected]); }
      }} /></div>
    <ul id="palette-list" role="listbox" aria-label="Commands">
      {results.map((command, position) => <li key={command.id} id={`palette-${command.id}`} role="option" aria-selected={position === selected}
        className={position === selected ? 'selected' : ''} onMouseMove={() => setIndex(position)} onClick={() => onPick(command)}>
        <span>{command.label}</span>{command.detail && <small>{command.detail}</small>}<em>{command.group}</em></li>)}
      {!results.length && <li className="palette-empty" role="presentation">No matching commands</li>}
    </ul>
  </div>;
}
