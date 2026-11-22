import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, openDb } from './db';
import { listRuns, listRunsForDomain, recordRun } from './runs';
import { emptyAccount, getAccount, putAccount } from './accounts';
import type { RunOutcome } from './run-outcome';

/**
 * IndexedDB in tests is provided by the fake-indexeddb devDependency
 * (the accounts tests exercise pure logic only, so no IDB test setup
 * existed before this file). Each test starts from a deleted DB.
 */

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await deleteDb();
});

const okOutcome: RunOutcome = {
  status: 'ok',
  reason: 'success',
  detail: 'Brief produced, complete, and fully grounded.',
};
const partialOutcome: RunOutcome = {
  status: 'partial',
  reason: 'max-tokens',
  detail: 'Generation stopped at max_tokens; the brief may be truncated.',
};
const failedOutcome: RunOutcome = {
  status: 'failed',
  reason: 'network-error',
  detail: 'Failed to fetch',
};

describe('runs store CRUD', () => {
  it('records a run and lists it back with the outcome verbatim', async () => {
    const record = await recordRun('acme.com', okOutcome, 1_000);
    expect(record.domain).toBe('acme.com');
    expect(record.finishedAt).toBe(1_000);
    expect(record.id).toBeTruthy();

    const runs = await listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(record);
    expect(runs[0].outcome).toEqual(okOutcome);
  });

  it('lists runs recent-first across domains', async () => {
    await recordRun('old.com', okOutcome, 1_000);
    await recordRun('new.com', failedOutcome, 3_000);
    await recordRun('mid.com', partialOutcome, 2_000);

    const runs = await listRuns();
    expect(runs.map((r) => r.domain)).toEqual(['new.com', 'mid.com', 'old.com']);
    expect(runs.map((r) => r.finishedAt)).toEqual([3_000, 2_000, 1_000]);
  });

  it('filters runs per domain, recent-first', async () => {
    await recordRun('acme.com', okOutcome, 1_000);
    await recordRun('other.com', okOutcome, 2_000);
    await recordRun('acme.com', failedOutcome, 3_000);

    const acme = await listRunsForDomain('acme.com');
    expect(acme.map((r) => r.finishedAt)).toEqual([3_000, 1_000]);
    expect(acme.every((r) => r.domain === 'acme.com')).toBe(true);
    expect(await listRunsForDomain('missing.com')).toEqual([]);
  });

  it('persists a partial outcome verbatim (status, reason, detail)', async () => {
    await recordRun('cut.com', partialOutcome, 5_000);
    const runs = await listRunsForDomain('cut.com');
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toEqual({
      status: 'partial',
      reason: 'max-tokens',
      detail: 'Generation stopped at max_tokens; the brief may be truncated.',
    });
  });

  it('persists a failed outcome verbatim', async () => {
    await recordRun('bad.com', failedOutcome, 5_000);
    const runs = await listRuns();
    expect(runs[0].outcome).toEqual(failedOutcome);
  });

  it('gives every record a unique id, even at the same timestamp', async () => {
    const a = await recordRun('a.com', okOutcome, 1_000);
    const b = await recordRun('a.com', okOutcome, 1_000);
    expect(a.id).not.toBe(b.id);
    expect(await listRuns()).toHaveLength(2);
  });
});

describe('v1 -> v2 migration', () => {
  /** Create a v1-shaped DB exactly as the old code did, with one account. */
  async function seedV1Database(): Promise<void> {
    const seeded = emptyAccount('seeded.com', 'Seeded Co', 'https://seeded.com', 42);
    seeded.notes = 'seeded at v1';
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'domain' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('accounts', 'readwrite');
        t.objectStore('accounts').put(seeded);
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  it('upgrades in place: seeded account intact, runs store present and working', async () => {
    await seedV1Database();

    // Production open path (accounts + runs share db.ts openDb at v2).
    const account = await getAccount('seeded.com');
    expect(account).not.toBeNull();
    expect(account?.company).toBe('Seeded Co');
    expect(account?.notes).toBe('seeded at v1');
    expect(account?.createdAt).toBe(42);

    const record = await recordRun('seeded.com', partialOutcome, 9_999);
    const runs = await listRunsForDomain('seeded.com');
    expect(runs).toEqual([record]);
    expect(runs[0].outcome).toEqual(partialOutcome);

    // Both stores exist side by side in the upgraded database.
    const db = await openDb();
    expect(db.version).toBe(2);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['accounts', 'runs']);
    db.close();

    // Accounts writes still work after the upgrade.
    const fresh = emptyAccount('fresh.com', 'Fresh Co', 'https://fresh.com', 100);
    await putAccount(fresh);
    expect((await getAccount('fresh.com'))?.company).toBe('Fresh Co');
    expect((await getAccount('seeded.com'))?.notes).toBe('seeded at v1');
  });
});
