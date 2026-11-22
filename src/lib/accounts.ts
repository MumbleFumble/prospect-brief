import type { Brief } from './brief';
import { ACCOUNTS_STORE, dbTx } from './db';
import type { Detection, NewsItem } from './types';
import type { HiringSignals } from './hiring';
import type { SavedBrief } from './saved';
import type { WatchEvent } from './watch';

/**
 * Account Store (v0.3 element 1).
 *
 * The product's center of gravity moves from pages to accounts. Each
 * account record holds timestamped signal snapshots, the latest brief,
 * a pipeline status, notes, and a log of outreach touches. Everything
 * else in the v0.3 pipeline (batch, scoring, sequences, watch) reads
 * from and writes to these records.
 *
 * Persistence is IndexedDB (chrome.storage.local fills up once snapshots
 * accumulate). Migration from the v0.2 saved-briefs list runs once.
 */

export type AccountStatus = 'researching' | 'contacted' | 'replied' | 'disqualified';

export const ACCOUNT_STATUSES: AccountStatus[] = [
  'researching',
  'contacted',
  'replied',
  'disqualified',
];

export interface SignalSnapshot {
  takenAt: number;
  detections: Detection[];
  news: NewsItem[];
  hiring: HiringSignals | null;
  /**
   * 'full' = collected from the live rendered page.
   * 'partial' = batch fetch of raw HTML (runtime-injected scripts missed).
   */
  detectionQuality: 'full' | 'partial';
}

export interface TouchLogEntry {
  id: string;
  kind: 'email' | 'linkedin' | 'other';
  /** Target persona label, if any (element 4). */
  persona: string | null;
  subject: string | null;
  body: string;
  /** The signal this touch was anchored on (grounding). */
  signal: string | null;
  createdAt: number;
  /** Null = drafted but not yet marked sent by the rep. */
  sentAt: number | null;
  /** When this touch is due (sequence day offsets). */
  scheduledFor?: number;
}

export interface AccountRecord {
  /** Primary key. */
  domain: string;
  company: string;
  url: string;
  status: AccountStatus;
  notes: string;
  /** Oldest first. Capped at MAX_SNAPSHOTS. */
  snapshots: SignalSnapshot[];
  brief: Brief | null;
  briefGeneratedAt: number | null;
  touches: TouchLogEntry[];
  /** Watch & re-engage (element 5). Optional: older records lack them. */
  watched?: boolean;
  lastWatchCheckAt?: number;
  watchEvents?: WatchEvent[];
  createdAt: number;
  updatedAt: number;
}

export const MAX_SNAPSHOTS = 10;

/* ------------------------------------------------------------------ */
/* Pure record logic (unit-tested)                                     */
/* ------------------------------------------------------------------ */

export function emptyAccount(
  domain: string,
  company: string,
  url: string,
  now: number,
): AccountRecord {
  return {
    domain,
    company,
    url,
    status: 'researching',
    notes: '',
    snapshots: [],
    brief: null,
    briefGeneratedAt: null,
    touches: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Append a snapshot (capped), optionally replacing the latest brief. */
export function applySnapshot(
  account: AccountRecord,
  snapshot: SignalSnapshot,
  brief?: Brief | null,
): AccountRecord {
  const snapshots = [...account.snapshots, snapshot].slice(-MAX_SNAPSHOTS);
  return {
    ...account,
    snapshots,
    ...(brief !== undefined
      ? { brief, briefGeneratedAt: brief ? snapshot.takenAt : account.briefGeneratedAt }
      : {}),
    updatedAt: snapshot.takenAt,
  };
}

export function setStatus(account: AccountRecord, status: AccountStatus, now: number): AccountRecord {
  return { ...account, status, updatedAt: now };
}

export function setNotes(account: AccountRecord, notes: string, now: number): AccountRecord {
  return { ...account, notes, updatedAt: now };
}

export function addTouch(account: AccountRecord, touch: TouchLogEntry): AccountRecord {
  return { ...account, touches: [...account.touches, touch], updatedAt: touch.createdAt };
}

export function markTouchSent(account: AccountRecord, touchId: string, now: number): AccountRecord {
  return {
    ...account,
    touches: account.touches.map((t) => (t.id === touchId ? { ...t, sentAt: now } : t)),
    updatedAt: now,
  };
}

export function latestSnapshot(account: AccountRecord): SignalSnapshot | null {
  return account.snapshots.length > 0 ? account.snapshots[account.snapshots.length - 1] : null;
}

/** Convert a v0.2 saved brief into an account record (migration). */
export function migrateSavedBrief(saved: SavedBrief): AccountRecord {
  const base = emptyAccount(saved.domain, saved.company, saved.url, saved.savedAt);
  return applySnapshot(
    base,
    {
      takenAt: saved.savedAt,
      detections: saved.detections,
      news: saved.news,
      hiring: saved.hiring,
      detectionQuality: 'full',
    },
    saved.brief,
  );
}

/** Shape an account back into a SavedBrief for the existing export helpers. */
export function accountToSavedBrief(account: AccountRecord): SavedBrief | null {
  if (!account.brief) return null;
  const snap = latestSnapshot(account);
  return {
    id: account.domain,
    company: account.company,
    domain: account.domain,
    url: account.url,
    brief: account.brief,
    detections: snap?.detections ?? [],
    news: snap?.news ?? [],
    hiring: snap?.hiring ?? null,
    savedAt: account.briefGeneratedAt ?? account.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Export / import (pure)                                              */
/* ------------------------------------------------------------------ */

export function exportAccountsJson(accounts: AccountRecord[]): string {
  return JSON.stringify({ format: 'prospect-brief-accounts', version: 1, accounts }, null, 2);
}

function isAccountRecord(v: unknown): v is AccountRecord {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.domain === 'string' &&
    typeof o.company === 'string' &&
    Array.isArray(o.snapshots) &&
    Array.isArray(o.touches) &&
    typeof o.createdAt === 'number'
  );
}

/** Parse an export file. Throws on unrecognized format. */
export function parseAccountsImport(json: string): AccountRecord[] {
  const data = JSON.parse(json) as { format?: string; accounts?: unknown };
  if (data.format !== 'prospect-brief-accounts' || !Array.isArray(data.accounts)) {
    throw new Error('Not a Prospect Brief accounts export.');
  }
  const accounts = data.accounts.filter(isAccountRecord);
  if (accounts.length === 0) throw new Error('No valid account records in the file.');
  return accounts;
}

/* ------------------------------------------------------------------ */
/* IndexedDB persistence (thin wrapper, no dependency)                 */
/* ------------------------------------------------------------------ */

const STORE = ACCOUNTS_STORE;

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return dbTx(STORE, mode, run);
}

export async function getAccount(domain: string): Promise<AccountRecord | null> {
  const rec = await tx<AccountRecord | undefined>('readonly', (s) => s.get(domain));
  return rec ?? null;
}

export async function putAccount(account: AccountRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(account));
}

export async function deleteAccount(domain: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(domain));
}

export async function listAccounts(): Promise<AccountRecord[]> {
  const all = await tx<AccountRecord[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Get-or-create the account for a domain, then apply a mutation and save. */
export async function upsertAccount(
  domain: string,
  company: string,
  url: string,
  mutate: (account: AccountRecord) => AccountRecord,
  now: number,
): Promise<AccountRecord> {
  const existing = await getAccount(domain);
  const base = existing ?? emptyAccount(domain, company, url, now);
  const next = mutate({ ...base, company: base.company || company, url });
  await putAccount(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* One-time migration from v0.2 saved briefs                           */
/* ------------------------------------------------------------------ */

const MIGRATION_FLAG = 'accounts:migrated:v1';

/**
 * Convert chrome.storage saved briefs into account records, once.
 * The old list is left in place (read-only fallback); a flag prevents
 * re-running. Safe to call on every startup.
 */
export async function migrateSavedBriefsIfNeeded(
  loadSaved: () => Promise<SavedBrief[]>,
): Promise<number> {
  const flags = await chrome.storage.local.get(MIGRATION_FLAG);
  if (flags[MIGRATION_FLAG]) return 0;
  const saved = await loadSaved();
  let count = 0;
  for (const entry of saved) {
    const existing = await getAccount(entry.domain);
    if (!existing) {
      await putAccount(migrateSavedBrief(entry));
      count++;
    }
  }
  await chrome.storage.local.set({ [MIGRATION_FLAG]: true });
  return count;
}
