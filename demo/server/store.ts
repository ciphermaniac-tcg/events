/** Where the demo's database is kept between visits: one IndexedDB entry in this browser. */

const NAME = 'ciphermaniac-demo';
const STORE = 'database';
const KEY = 'tournaments';

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

/** The saved database; null when there is none, or storage is closed to the page (a private window). */
export async function loadSaved(): Promise<Uint8Array | null> {
  try {
    const db = await open();
    const value = (await done(db.transaction(STORE).objectStore(STORE).get(KEY))) as Uint8Array | undefined;
    return value ?? null;
  } catch {
    return null;
  }
}

/** Keeps `bytes` for the next visit; without storage the demo simply starts over each time. */
export async function save(bytes: Uint8Array): Promise<void> {
  try {
    const db = await open();
    await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(bytes, KEY));
  } catch {
    // Storage closed to the page: the demo still runs, for this visit only.
  }
}

export async function forget(): Promise<void> {
  try {
    const db = await open();
    await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY));
  } catch {
    // Nothing was kept.
  }
}
