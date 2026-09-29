import type { Session } from '../shared/types';
import { folderName } from './format';

/** Local organization for sessions. Never written to the CLI or to shared session files. */
export interface SessionMeta { pinned: string[]; tags: Record<string, string[]>; groupBy: 'date' | 'workspace'; }
export const META_KEY = 'session-dock.session-meta.v1';
export const MAX_TAGS = 6;
export const MAX_TAG_LENGTH = 24;
const empty = (): SessionMeta => ({ pinned: [], tags: {}, groupBy: 'date' });

export function normalizeTags(input: string): string[] {
  const seen = new Set<string>(), tags: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const tag = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
    if (tag && !seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); tags.push(tag); }
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

export function loadSessionMeta(): SessionMeta {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(META_KEY) || '{}');
    if (!value || typeof value !== 'object') return empty();
    const record = value as Record<string, unknown>;
    const pinned = Array.isArray(record.pinned) ? record.pinned.filter((id): id is string => typeof id === 'string' && id.length <= 4096).slice(0, 500) : [];
    const tags: Record<string, string[]> = {};
    if (record.tags && typeof record.tags === 'object') for (const [id, list] of Object.entries(record.tags as Record<string, unknown>).slice(0, 2000)) {
      if (Array.isArray(list)) { const clean = normalizeTags(list.filter(tag => typeof tag === 'string').join(',')); if (clean.length) tags[id] = clean; }
    }
    return { pinned, tags, groupBy: record.groupBy === 'workspace' ? 'workspace' : 'date' };
  } catch { return empty(); }
}
export function saveSessionMeta(meta: SessionMeta): boolean {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); return true; } catch { return false; }
}
export const togglePin = (meta: SessionMeta, id: string): SessionMeta => ({ ...meta, pinned: meta.pinned.includes(id) ? meta.pinned.filter(item => item !== id) : [id, ...meta.pinned] });
export function setTags(meta: SessionMeta, id: string, tags: string[]): SessionMeta {
  const next = { ...meta.tags };
  if (tags.length) next[id] = tags; else delete next[id];
  return { ...meta, tags: next };
}
export function allTags(meta: SessionMeta, sessions: Session[]): string[] {
  const live = new Set(sessions.map(session => session.id));
  const counts = new Map<string, string>();
  for (const [id, list] of Object.entries(meta.tags)) if (live.has(id)) for (const tag of list) counts.set(tag.toLowerCase(), counts.get(tag.toLowerCase()) ?? tag);
  return [...counts.values()].sort((a, b) => a.localeCompare(b));
}

export interface GroupOptions { search: string; tag: string; meta: SessionMeta; now?: number }
/** Sidebar groups: pinned sessions first, then by date or workspace. Search also matches tags. */
export function groupSessions(sessions: Session[], { search, tag, meta, now = Date.now() }: GroupOptions): [string, Session[]][] {
  const needle = search.toLowerCase();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const visible = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(session => {
    const tags = meta.tags[session.id] ?? [];
    if (tag && !tags.some(item => item.toLowerCase() === tag.toLowerCase())) return false;
    return `${session.title} ${session.cwd} ${tags.join(' ')}`.toLowerCase().includes(needle);
  });
  const pinned = new Set(meta.pinned);
  const groups = new Map<string, Session[]>();
  const add = (label: string, session: Session) => groups.set(label, [...(groups.get(label) ?? []), session]);
  const pinnedSessions = meta.pinned.map(id => visible.find(session => session.id === id)).filter((session): session is Session => !!session);
  if (pinnedSessions.length) groups.set('Pinned', pinnedSessions);
  for (const session of visible) {
    if (pinned.has(session.id)) continue;
    if (meta.groupBy === 'workspace') add(folderName(session.cwd), session);
    else { const age = startOfToday.getTime() - new Date(session.updatedAt).getTime(); add(age <= 0 ? 'Today' : age < 7 * 86400000 ? 'Previous 7 days' : 'Earlier', session); }
  }
  const order = ['Pinned', 'Today', 'Previous 7 days', 'Earlier'];
  return [...groups.entries()].sort(([a], [b]) => meta.groupBy === 'date' ? order.indexOf(a) - order.indexOf(b) : a === 'Pinned' ? -1 : b === 'Pinned' ? 1 : a.localeCompare(b));
}
