/**
 * Durable browser-development media storage.
 *
 * The shipped Tauri app writes media bytes beneath the library assets root.
 * Vite has no filesystem command, but it must still behave like the product
 * across a reload: an object URL alone dies with the JavaScript realm. Keep
 * the same rel-path contract and persist the Blob in IndexedDB instead.
 */

const DATABASE = 'alcove-dev-assets';
const VERSION = 1;
const STORE = 'media';

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function saveDevAssetBlob(relPath: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(blob, relPath);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  db.close();
}

export async function loadDevAssetBlob(relPath: string): Promise<Blob | null> {
  const db = await openDatabase();
  if (db === null) return null;
  const blob = await new Promise<Blob | null>((resolve) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(relPath);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => resolve(null);
    transaction.onabort = () => resolve(null);
  });
  db.close();
  return blob;
}
