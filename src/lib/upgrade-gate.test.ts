import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAccount, getAccount, putAccount, type AccountRecord } from './accounts';
import {
  createBatchState,
  runBatchQueue,
  type BatchQueueDeps,
  type BatchState,
} from './batch';
import { getCachedBrief, type CachedBrief } from './cache';
import { ACCOUNTS_STORE, DB_NAME, DB_VERSION, openDb, RUNS_STORE } from './db';
import { listRuns, recordRun } from './runs';
import { listSavedBriefs, type SavedBrief } from './saved';
import { getSettings } from './settings';
import type { RunOutcome } from './run-outcome';

/**
 * RELEASE GATE (inc-029): a v0.4.0 user's persisted state must
 * upgrade cleanly to the release code. Legs: (b1) a v1-shaped DB
 * (accounts only) opened by release code; (b2) a current v2 DB;
 * (b3) stored briefs (schemaVersion-absent and schemaVersion-2)
 * read back exactly as stored — stored briefs are plain JSON and
 * are NOT re-validated on read; (b4) settings/profile/API key in
 * v0.4 shape; (c) an upgrade interrupted mid-onupgradeneeded
 * recovers on the next open; (d) an in-progress batch state in
 * the v0.4 shape resumes to a named-outcome completion.
 *
 * Harness limits (stated honestly): fake-indexeddb simulates
 * IndexedDB semantics in-process — it can abort a versionchange
 * transaction, but it cannot simulate a real browser process
 * kill or on-disk corruption.
 */

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** In-memory chrome.storage.local, deep-cloning like the real API. */
function stubChromeStorage() {
  const store = new Map<string, unknown>();
  const local = {
    // The Chrome API accepts a single key, an array, or null —
    // the code under test uses all three forms.
    get: async (keys: string | string[] | null) => {
      const list = keys === null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (store.has(k)) out[k] = structuredClone(store.get(k));
      return out;
    },
    set: async (entries: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(entries)) store.set(k, structuredClone(v));
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
  vi.stubGlobal('chrome', { storage: { local } });
  return store;
}

const okOutcome: RunOutcome = {
  status: 'ok',
  reason: 'success',
  detail: 'Brief produced, complete, and fully grounded.',
};

/** A legacy (pre-v0.5) brief payload: no schemaVersion, no v0.5 sections. */
const LEGACY_BRIEF = {
  overview: 'Legacy Co sells widgets.',
  overviewRefs: [0],
  talkingPoints: [{ point: 'Ask about widgets.', sourceRefs: [0], stackRefs: [], basis: 'news' }],
};

function legacyAccount(domain: string): AccountRecord {
  const account = emptyAccount(domain, 'Legacy Co', `https://${domain}/`, 1000);
  // A brief exactly as a pre-v0.5 build stored it (plain JSON).
  account.brief = LEGACY_BRIEF as unknown as AccountRecord['brief'];
  return account;
}

/** Open a raw v1-shaped database (accounts store only) and seed it. */
function seedV1Database(accounts: AccountRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ACCOUNTS_STORE, { keyPath: 'domain' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(ACCOUNTS_STORE, 'readwrite');
      const store = tx.objectStore(ACCOUNTS_STORE);
      for (const a of accounts) store.put(structuredClone(a));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function readAllAccounts(db: IDBDatabase): Promise<AccountRecord[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(ACCOUNTS_STORE).objectStore(ACCOUNTS_STORE).getAll();
    req.onsuccess = () => resolve(req.result as AccountRecord[]);
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await deleteDb();
  vi.unstubAllGlobals();
});

describe('release gate: IndexedDB upgrade', () => {
  it('(b1) a v1-shaped DB opens under release code: accounts identical, runs store created', async () => {
    const seeded = [legacyAccount('a.com'), legacyAccount('b.com')];
    await seedV1Database(seeded);

    const db = await openDb();
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([ACCOUNTS_STORE, RUNS_STORE].sort());
    const after = await readAllAccounts(db);
    db.close();
    expect(after).toEqual(seeded);
    // And through the release code's own read path:
    expect(await getAccount('a.com')).toEqual(seeded[0]);
  });

  it('(b2) a current v2 DB keeps accounts and runs intact across a reopen', async () => {
    const account = legacyAccount('a.com');
    await putAccount(account);
    await recordRun('a.com', okOutcome, 5000, 'batch-1');

    const db = await openDb();
    expect([...db.objectStoreNames].sort()).toEqual([ACCOUNTS_STORE, RUNS_STORE].sort());
    db.close();
    expect(await getAccount('a.com')).toEqual(account);
    const runs = await listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ domain: 'a.com', outcome: okOutcome, batchId: 'batch-1' });
  });

  it('(c) an upgrade aborted mid-onupgradeneeded recovers fully on the next open', async () => {
    const seeded = [legacyAccount('a.com')];
    await seedV1Database(seeded);

    // Simulate the interruption: open at v2 and abort the
    // versionchange transaction while it is running.
    const aborted = await new Promise<boolean>((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(RUNS_STORE, { keyPath: 'id' });
        req.transaction?.abort();
      };
      req.onsuccess = () => resolve(false);
      req.onerror = () => resolve(true);
    });
    expect(aborted).toBe(true);

    // The NEXT open must recover to the fully-new shape with the
    // v1 records intact — never a half-created store set.
    const db = await openDb();
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([ACCOUNTS_STORE, RUNS_STORE].sort());
    const after = await readAllAccounts(db);
    db.close();
    expect(after).toEqual(seeded);
  });
});

describe('release gate: chrome.storage surfaces', () => {
  it('(b3) stored briefs read back exactly as stored (schemaVersion-absent and v2)', async () => {
    const store = stubChromeStorage();
    const legacySaved: SavedBrief = {
      id: 'a.com:1',
      company: 'Legacy Co',
      domain: 'a.com',
      url: 'https://a.com/',
      brief: LEGACY_BRIEF as unknown as SavedBrief['brief'],
      detections: [],
      news: [],
      hiring: null,
      savedAt: 1000,
    };
    const v2Saved: SavedBrief = {
      ...legacySaved,
      id: 'b.com:2',
      domain: 'b.com',
      url: 'https://b.com/',
      brief: {
        schemaVersion: 2,
        overview: 'V2 Co sells gadgets.',
        overviewRefs: [],
        overviewStackRefs: [0],
        overviewBasis: 'site',
        talkingPoints: [
          { point: 'Ask about gadgets.', sourceRefs: [], stackRefs: [0], basis: 'stack' },
        ],
        risks: [{ point: 'Churn risk.', sourceRefs: [0], stackRefs: [], basis: 'inference' }],
        opportunities: [],
      },
      savedAt: 2000,
    };
    store.set('saved:briefs', [legacySaved, v2Saved]);

    // No re-validation or normalisation on read: byte-for-byte
    // the payloads that were stored (deep-equal after the
    // storage serialisation round-trip).
    expect(await listSavedBriefs()).toEqual([legacySaved, v2Saved]);

    const cached: CachedBrief = {
      domain: 'a.com',
      brief: LEGACY_BRIEF as unknown as CachedBrief['brief'],
      signals: null as unknown as CachedBrief['signals'],
      detections: [],
      news: [],
      hiring: null,
      cachedAt: Date.now(),
    };
    store.set('brief:a.com', cached);
    const readBack = await getCachedBrief('a.com');
    expect(readBack?.brief).toEqual(LEGACY_BRIEF);
  });

  it('(b4) settings in v0.4 shape read correctly; the API key stays functional-shaped', async () => {
    const store = stubChromeStorage();
    store.set('apiKey', 'sk-ant-gate-fixture-not-a-real-key');
    store.set('model', 'claude-sonnet-4-5');
    store.set('sellerProfile', {
      whatYouSell: 'Widgets',
      icp: 'Ops teams',
      valueProps: 'Saves time',
      competitors: ['OtherCo'],
    });
    const settings = await getSettings();
    // Shape assertions only — the key's value is never printed.
    expect(typeof settings.apiKey).toBe('string');
    expect(settings.apiKey.length).toBeGreaterThan(0);
    expect(settings.model).toBe('claude-sonnet-4-5');
    expect(settings.sellerProfile.whatYouSell).toBe('Widgets');
    expect(settings.sellerProfile.competitors).toEqual(['OtherCo']);
  });
});

describe('release gate: batch queue upgrade', () => {
  function makeDeps(stored: BatchState | null) {
    const records: Array<{ domain: string; outcome: RunOutcome; batchId: string | null }> = [];
    const researched: string[] = [];
    const deps: BatchQueueDeps = {
      loadState: async () => (stored ? structuredClone(stored) : null),
      saveState: async (s) => {
        stored = structuredClone(s);
      },
      clearState: async () => {
        stored = null;
      },
      research: async (domain) => {
        researched.push(domain);
        return okOutcome;
      },
      record: async (domain, outcome, _finishedAt, batchId) => {
        records.push({ domain, outcome, batchId });
      },
      findRecordedOutcome: async (batchId, domain) => {
        const m = records.find((r) => r.batchId === batchId && r.domain === domain);
        return m ? { outcome: m.outcome, finishedAt: 0 } : null;
      },
      now: () => 9999,
    };
    return {
      deps,
      records,
      researched,
      get stored() {
        return stored;
      },
    };
  }

  it('(d) a v0.4 in-progress batch (one item stuck running) resumes to a named-outcome completion', async () => {
    // The shape an upgrade mid-batch leaves behind: batchId
    // present, one item stuck 'running', heartbeat long stale.
    const seeded = createBatchState(['a.com', 'b.com'], 1000);
    seeded.items[0].status = 'running';
    seeded.heartbeat = 1;
    const h = makeDeps(seeded);

    await runBatchQueue(h.deps);

    // Both domains researched exactly once (the stuck item was
    // reset and re-run; nothing looped), every outcome recorded
    // under a RunOutcome class, and the queue drained — no
    // resumable state left behind.
    expect(h.researched.sort()).toEqual(['a.com', 'b.com']);
    expect(h.records.map((r) => r.outcome.status)).toEqual(['ok', 'ok']);
    expect(h.stored).toBeNull();
  });

  it('(d) a legacy pre-batchId batch state also drains cleanly', async () => {
    const legacy = createBatchState(['a.com'], 1000);
    delete legacy.batchId;
    const h = makeDeps(legacy);

    await runBatchQueue(h.deps);

    expect(h.researched).toEqual(['a.com']);
    expect(h.records).toHaveLength(1);
    expect(h.records[0].outcome.status).toBe('ok');
    expect(h.stored).toBeNull();
  });
});
