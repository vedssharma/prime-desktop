export interface Command { id: string; label: string; group: 'Actions' | 'Sessions'; detail?: string; keywords?: string; run: () => void }

// Higher is better; 0 means no match. Prefix > word start > substring > in-order letters.
export function scoreCommand(command: Pick<Command, 'label' | 'keywords' | 'detail'>, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  const label = command.label.toLowerCase();
  if (label.startsWith(needle)) return 5;
  if (label.split(/[\s/:._-]+/).some(word => word.startsWith(needle))) return 4;
  if (label.includes(needle)) return 3;
  if (`${command.keywords ?? ''} ${command.detail ?? ''}`.toLowerCase().includes(needle)) return 2;
  let index = 0;
  for (const char of label) if (char === needle[index] && ++index === needle.length) return 1;
  return 0;
}

export function filterCommands<T extends Command>(commands: T[], query: string): T[] {
  return commands
    .map((command, order) => ({ command, order, score: scoreCommand(command, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(entry => entry.command);
}
