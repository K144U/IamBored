// Sandbox persistence in IndexedDB: the raw runs and players. The map is rebuilt by replaying runs.
import type { Activity, Player } from './types';

const DB = 'loopland';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('players', { keyPath: 'id' });
      req.result.createObjectStore('activities', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve((req ? req.result : undefined) as T);
    t.onerror = () => reject(t.error);
  });
}

export const store = {
  async load(): Promise<{ players: Player[]; activities: Activity[] }> {
    try {
      const players = await tx<Player[]>('players', 'readonly', (s) => s.getAll());
      const activities = await tx<Activity[]>('activities', 'readonly', (s) => s.getAll());
      return { players, activities };
    } catch {
      return { players: [], activities: [] };
    }
  },
  async putPlayers(players: Player[]) {
    await tx('players', 'readwrite', (s) => void players.forEach((p) => s.put(p))).catch(() => {});
  },
  async putActivities(acts: Activity[]) {
    await tx('activities', 'readwrite', (s) => void acts.forEach((a) => s.put(a))).catch(() => {});
  },
  async deleteActivity(id: string) {
    await tx('activities', 'readwrite', (s) => s.delete(id)).catch(() => {});
  },
  async clear() {
    await tx('players', 'readwrite', (s) => s.clear()).catch(() => {});
    await tx('activities', 'readwrite', (s) => s.clear()).catch(() => {});
  },
};
