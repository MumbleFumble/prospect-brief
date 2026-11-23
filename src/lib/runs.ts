import { RUNS_STORE, dbTx } from './db';
import type { RunOutcome } from './run-outcome';

/**
 * Runs store (v0.4 step 4).
 *
 * Every classified run outcome (inc-007) is persisted in the 'runs'
 * object store of the shared 'prospect-brief' database (v2, see
 * db.ts), so later steps — a resumable queue, a run summary with
 * retry — have a durable, queryable history instead of state that
 * dies with the batch. Records are append-only; the only retention
 * rule is the MAX_RUNS cap below.
 */

export interface RunRecord {
  /** Primary key. Unique per record. */
  id: string;
  domain: string;
  /** When the run finished (ms since epoch). */
  finishedAt: number;
  /** The full classified outcome, stored verbatim. */
  outcome: RunOutcome;
  /**
   * The batch this run belonged to, when recorded from the batch
   * path (v0.4 step 5) — lets a resumed batch tell its own recorded
   * outcomes from any other batch's. Null/absent for non-batch runs.
   */
  batchId?: string | null;
}

/** Retention cap: recordRun prunes the oldest records beyond this. */
export const MAX_RUNS = 500;

const DEFAULT_LIST_LIMIT = 50;

let idCounter = 0;

function newRunId(finishedAt: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  idCounter += 1;
  return `run-${finishedAt}-${idCounter}`;
}

function byRecentFirst(a: RunRecord, b: RunRecord): number {
  return b.finishedAt - a.finishedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Persist one finished run's outcome. Returns the stored record. */
export async function recordRun(
  domain: string,
  outcome: RunOutcome,
  finishedAt: number = Date.now(),
  batchId?: string | null,
): Promise<RunRecord> {
  const record: RunRecord = {
    id: newRunId(finishedAt),
    domain,
    finishedAt,
    outcome,
    batchId: batchId ?? null,
  };
  await dbTx(RUNS_STORE, 'readwrite', (s) => s.add(record));
  await pruneRuns().catch(() => {});
  return record;
}

/** Delete the oldest records beyond MAX_RUNS. Best-effort. */
async function pruneRuns(): Promise<void> {
  const all = await dbTx<RunRecord[]>(RUNS_STORE, 'readonly', (s) => s.getAll());
  if (all.length <= MAX_RUNS) return;
  const oldestFirst = [...all].sort((a, b) => a.finishedAt - b.finishedAt || (a.id < b.id ? -1 : 1));
  const excess = oldestFirst.slice(0, all.length - MAX_RUNS);
  // One transaction per delete keeps this on the shared tx helper;
  // pruning is best-effort and never fails the recording run.
  for (const record of excess) {
    await dbTx(RUNS_STORE, 'readwrite', (s) => s.delete(record.id)).catch(() => {});
  }
}

/** Most recent runs first, across all domains. */
export async function listRuns(limit: number = DEFAULT_LIST_LIMIT): Promise<RunRecord[]> {
  const all = await dbTx<RunRecord[]>(RUNS_STORE, 'readonly', (s) => s.getAll());
  return all.sort(byRecentFirst).slice(0, limit);
}

/** Most recent runs for one domain first, via the 'domain' index. */
export async function listRunsForDomain(
  domain: string,
  limit: number = DEFAULT_LIST_LIMIT,
): Promise<RunRecord[]> {
  const records = await dbTx<RunRecord[]>(RUNS_STORE, 'readonly', (s) =>
    s.index('domain').getAll(domain),
  );
  return records.sort(byRecentFirst).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Batch run summary (v0.4 step 6)                                     */
/* ------------------------------------------------------------------ */

/**
 * Exact outcome counts for one completed batch, derived from its
 * recorded runs — the durable summary the Accounts view shows after
 * a batch finishes (batch state itself is removed on completion).
 */
export interface BatchRunSummary {
  batchId: string;
  /** finishedAt of the batch's most recent recorded run. */
  finishedAt: number;
  total: number;
  ok: number;
  partial: number;
  failed: number;
  skipped: number;
  /** Domains whose outcome was partial or failed — the retry set. */
  retryDomains: string[];
  /** The non-ok records, recent-first, for display. */
  issues: RunRecord[];
}

/**
 * Summarize the records of ONE batch (any order). Pure. Returns null
 * for an empty record set. If a domain somehow has two records in
 * the batch, the most recent one wins, so counts and the retry set
 * always describe each domain exactly once.
 */
export function summarizeBatchRuns(records: RunRecord[]): BatchRunSummary | null {
  if (records.length === 0) return null;
  const sorted = [...records].sort(byRecentFirst);
  const latestByDomain = new Map<string, RunRecord>();
  for (const record of sorted) {
    if (!latestByDomain.has(record.domain)) latestByDomain.set(record.domain, record);
  }
  const latest = [...latestByDomain.values()];
  const count = (status: RunOutcome['status']) =>
    latest.filter((r) => r.outcome.status === status).length;
  const issues = latest
    .filter((r) => r.outcome.status === 'partial' || r.outcome.status === 'failed')
    .sort(byRecentFirst);
  return {
    batchId: sorted[0].batchId ?? '',
    finishedAt: sorted[0].finishedAt,
    total: latest.length,
    ok: count('ok'),
    partial: count('partial'),
    failed: count('failed'),
    skipped: count('skipped'),
    retryDomains: issues.map((r) => r.domain),
    issues,
  };
}

/** All recorded runs for one batch, recent-first. */
export async function listRunsForBatch(batchId: string): Promise<RunRecord[]> {
  const all = await dbTx<RunRecord[]>(RUNS_STORE, 'readonly', (s) => s.getAll());
  return all.filter((r) => r.batchId === batchId).sort(byRecentFirst);
}

/**
 * The summary of the most recent batch that recorded any runs, or
 * null if no batch has. Derived entirely from the runs store, so it
 * survives popup close and the batch-state record being removed.
 */
export async function getLatestBatchSummary(): Promise<BatchRunSummary | null> {
  const recent = await listRuns(MAX_RUNS);
  const latest = recent.find((r) => r.batchId);
  if (!latest?.batchId) return null;
  return summarizeBatchRuns(await listRunsForBatch(latest.batchId));
}
