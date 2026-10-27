import type { AccountRecord, SignalSnapshot } from './accounts';

/**
 * Watch & re-engage (v0.3 element 5).
 *
 * Deterministic diffing between signal snapshots: re-checks compare the
 * new snapshot with the last one and only call the model when something
 * actually changed (a drafted follow-up), so watching many accounts
 * does not quietly burn the user's API budget.
 */

export type WatchEventKind =
  | 'new-tech'
  | 'removed-tech'
  | 'hiring-up'
  | 'hiring-down'
  | 'new-department'
  | 'news';

export interface WatchEvent {
  id: string;
  kind: WatchEventKind;
  /** Human-readable, names the evidence it came from. */
  summary: string;
  at: number;
}

const HIRING_DELTA = 3;
const MAX_NEWS_EVENTS = 3;

export function diffSnapshots(prev: SignalSnapshot, next: SignalSnapshot): WatchEvent[] {
  const events: WatchEvent[] = [];
  const at = next.takenAt;
  const push = (kind: WatchEventKind, summary: string) =>
    events.push({ id: `watch:${at}:${events.length}`, kind, summary, at });

  // Tech stack changes.
  const prevTech = new Set(prev.detections.map((d) => d.name));
  const nextTech = new Set(next.detections.map((d) => d.name));
  const added = [...nextTech].filter((n) => !prevTech.has(n));
  const removed = [...prevTech].filter((n) => !nextTech.has(n));
  if (added.length > 0) push('new-tech', `New technology detected: ${added.slice(0, 4).join(', ')}`);
  if (removed.length > 0) {
    push('removed-tech', `Technology removed: ${removed.slice(0, 4).join(', ')}`);
  }

  // Hiring changes.
  if (next.hiring && !prev.hiring && next.hiring.totalRoles > 0) {
    push('hiring-up', `Started hiring: ${next.hiring.totalRoles} open roles`);
  } else if (prev.hiring && next.hiring) {
    const delta = next.hiring.totalRoles - prev.hiring.totalRoles;
    if (delta >= HIRING_DELTA) {
      push('hiring-up', `Open roles grew ${prev.hiring.totalRoles} → ${next.hiring.totalRoles}`);
    } else if (delta <= -HIRING_DELTA) {
      push('hiring-down', `Open roles fell ${prev.hiring.totalRoles} → ${next.hiring.totalRoles}`);
    }
    const prevDepts = new Set(prev.hiring.departments.map((d) => d.name.toLowerCase()));
    const newDepts = next.hiring.departments
      .filter((d) => !prevDepts.has(d.name.toLowerCase()))
      .map((d) => d.name);
    if (newDepts.length > 0) {
      push('new-department', `New hiring department: ${newDepts.slice(0, 3).join(', ')}`);
    }
  }

  // New headlines (matched by link).
  const prevLinks = new Set(prev.news.map((n) => n.link));
  const fresh = next.news.filter((n) => !prevLinks.has(n.link));
  for (const item of fresh.slice(0, MAX_NEWS_EVENTS)) {
    push('news', `New headline: ${item.title}`);
  }

  return events;
}

/** Unacknowledged watch events on an account (older records may lack the field). */
export function pendingWatchEvents(account: AccountRecord): WatchEvent[] {
  return account.watchEvents ?? [];
}
