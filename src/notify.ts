import type { Session } from '../shared/types';

export const NOTIFY_KEY = 'session-dock.notifications.v1';
export function loadNotify(): boolean {
  try { return localStorage.getItem(NOTIFY_KEY) !== 'off'; } catch { return true; }
}
export function saveNotify(enabled: boolean): boolean {
  try { localStorage.setItem(NOTIFY_KEY, enabled ? 'on' : 'off'); return true; } catch { return false; }
}

/** Sessions that were running in `previous` and are no longer running in `next`. */
export function finishedSessions(previous: ReadonlyMap<string, Session['status']>, next: Session[]): Session[] {
  return next.filter(session => previous.get(session.id) === 'running' && session.status !== 'running');
}

export function notificationFor(session: Session): { title: string; body: string } {
  const failed = session.status === 'error';
  return { title: failed ? 'Session stopped with an error' : 'Session finished', body: session.title || 'Untitled session' };
}
