export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export const folderName = (path: string) => path.replace(/[\\/]$/, '').split(/[\\/]/).pop() || path || 'Choose a folder';
export const relativeTime = (value: string) => { const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); return mins < 1 ? 'now' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`; };
// Today's messages show only the time; older ones include the date (and year, if not this year).
export const messageTime = (value: string) => {
  const date = new Date(value), now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}, ${time}`;
};
