// IndexedDB save slots. Saves are full GameState JSON plus a small metadata row.

const DB = 'star-dominion';
const STORE = 'saves';

export interface SaveMeta { slot: string; name: string; realm: string; tick: number; savedAt: number; size: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export async function writeSave(meta: Omit<SaveMeta, 'savedAt' | 'size'>, data: string): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...meta, savedAt: Date.now(), size: data.length, data }));
}

export async function readSave(slot: string): Promise<string | null> {
  const row = await tx<any>('readonly', (s) => s.get(slot));
  return row ? row.data : null;
}

export async function listSaves(): Promise<SaveMeta[]> {
  const rows = await tx<any[]>('readonly', (s) => s.getAll());
  return rows.map(({ data: _d, ...m }) => m as SaveMeta).sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSave(slot: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
}
