/**
 * Shared IndexedDB open for the 'prospect-brief' database.
 *
 * One database, versioned upgrades only: onupgradeneeded CREATES any
 * missing store and never drops or recreates an existing one, so a
 * v1 user's account records survive the v2 upgrade untouched.
 *
 * - v1: 'accounts' store (keyPath 'domain') — account records.
 * - v2: adds 'runs' store (keyPath 'id', indexes on 'domain' and
 *   'finishedAt') — classified run outcomes (v0.4 step 4).
 */

export const DB_NAME = 'prospect-brief';
export const DB_VERSION = 2;
export const ACCOUNTS_STORE = 'accounts';
export const RUNS_STORE = 'runs';

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ACCOUNTS_STORE)) {
        db.createObjectStore(ACCOUNTS_STORE, { keyPath: 'domain' });
      }
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        const runs = db.createObjectStore(RUNS_STORE, { keyPath: 'id' });
        runs.createIndex('domain', 'domain', { unique: false });
        runs.createIndex('finishedAt', 'finishedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run one request against one store in a fresh connection. */
export function dbTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = run(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
        t.onerror = () => reject(t.error);
      }),
  );
}
