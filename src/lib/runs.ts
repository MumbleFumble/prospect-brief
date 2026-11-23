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
