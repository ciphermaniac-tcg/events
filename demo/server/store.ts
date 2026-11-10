/**
 * Where the demo's database is kept between visits, and shared between this
 * browser's tabs: one IndexedDB entry, with a version that changes on every
 * save, so a tab can tell when another tab saved since it last looked.
 */

const NAME = 'ciphermaniac-demo';
const STORE = 'database';
const KEY = 'tournaments';
const VERSION = 'version';

export interface Saved {
  bytes: Uint8Array;
  version: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open'));
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB write aborted')));
  });
}

/**
 * Runs `use` on the store in one transaction, resolving once the transaction
 * has committed, and closes the connection after: every request asks, so
 * none may be left open.
 */
async function inStore<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await open();
  try {
    const transaction = db.transaction(STORE, mode);
    const [result] = await Promise.all([use(transaction.objectStore(STORE)), finished(transaction)]);
    return result;
  } finally {
    db.close();
  }
}

/** The saved database; null when there is none, or storage is closed to the page (a private window). */
export async function loadSaved(): Promise<Saved | null> {
  try {
    const [bytes, version] = await inStore('readonly', store =>
      Promise.all([done(store.get(KEY)), done(store.get(VERSION))])
    );
    // A database saved before versions were kept counts as one version of its own.
    return bytes instanceof Uint8Array ? { bytes, version: typeof version === 'string' ? version : '' } : null;
  } catch {
    return null;
  }
}

/** The version saved last; null when nothing is saved or storage is closed. */
export async function savedVersion(): Promise<string | null> {
  try {
    const version: unknown = await inStore('readonly', store => done(store.get(VERSION)));
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/** Keeps `bytes` for the next visit and the other tabs; false when storage is closed and the demo runs for this tab only. */
export async function save(bytes: Uint8Array, version: string): Promise<boolean> {
  try {
    await inStore('readwrite', store => {
      store.put(bytes, KEY);
      store.put(version, VERSION);
    });
    return true;
  } catch {
    return false;
  }
}

export async function forget(): Promise<void> {
  try {
    await inStore('readwrite', store => {
      store.clear();
    });
  } catch {
    // Nothing was kept.
  }
}

/**
 * Runs `work` while no other tab of the demo runs any, so each request sees
 * every save before it and no two tabs save over each other.
 */
export async function alone<T>(work: () => Promise<T>): Promise<T> {
  return 'locks' in navigator ? await navigator.locks.request(NAME, work) : await work();
}
