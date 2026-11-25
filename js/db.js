// IndexedDB storage for scripts (projects) and recorded videos (takes).
// Videos are stored as Blobs, so they survive app restarts and work offline.

const DB_NAME = 'impromptu';
const DB_VERSION = 2;

/** Takes that could not be written to storage (e.g. disk full) — kept for this session so they can still be exported. */
export const memoryTakes = new Map();

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('takes')) {
        const s = db.createObjectStore('takes', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId', { unique: false });
      }
      // v2: recordings in progress are written here piece by piece (crash recovery).
      if (!db.objectStoreNames.contains('recs')) db.createObjectStore('recs', { keyPath: 'rid' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['rid', 'seq'] });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(t))
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        try {
          t.abort();
        } catch {
          /* already finished */
        }
        reject(e);
      });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const db = {
  async listProjects() {
    const all = await tx('projects', 'readonly', (t) => promisify(t.objectStore('projects').getAll()));
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  getProject(id) {
    return tx('projects', 'readonly', (t) => promisify(t.objectStore('projects').get(id)));
  },

  async putProject(p) {
    await tx('projects', 'readwrite', (t) => promisify(t.objectStore('projects').put(p)));
    return p;
  },

  async deleteProject(id) {
    await tx(['projects', 'takes'], 'readwrite', async (t) => {
      t.objectStore('projects').delete(id);
      const idx = t.objectStore('takes').index('projectId');
      const keys = await promisify(idx.getAllKeys(id));
      for (const k of keys) t.objectStore('takes').delete(k);
    });
  },

  async listTakes(projectId) {
    const all = await tx('takes', 'readonly', (t) =>
      promisify(t.objectStore('takes').index('projectId').getAll(projectId))
    );
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  async takeCounts() {
    const counts = new Map();
    await tx('takes', 'readonly', (t) => {
      return new Promise((resolve, reject) => {
        const req = t.objectStore('takes').index('projectId').openKeyCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          counts.set(c.key, (counts.get(c.key) || 0) + 1);
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
    return counts;
  },

  getTake(id) {
    return tx('takes', 'readonly', (t) => promisify(t.objectStore('takes').get(id)));
  },

  async putTake(take) {
    await tx('takes', 'readwrite', (t) => promisify(t.objectStore('takes').put(take)));
    return take;
  },

  async deleteTake(id) {
    await tx('takes', 'readwrite', (t) => promisify(t.objectStore('takes').delete(id)));
  },

  async deleteAllTakes() {
    await tx('takes', 'readwrite', (t) => promisify(t.objectStore('takes').clear()));
  },

  // ---- recordings in progress (crash-safe chunks)

  async putRec(rec) {
    await tx('recs', 'readwrite', (t) => promisify(t.objectStore('recs').put(rec)));
  },

  async patchRec(rid, patch) {
    await tx('recs', 'readwrite', async (t) => {
      const s = t.objectStore('recs');
      const cur = await promisify(s.get(rid));
      if (cur) s.put({ ...cur, ...patch });
    });
  },

  listRecs() {
    return tx('recs', 'readonly', (t) => promisify(t.objectStore('recs').getAll()));
  },

  async putChunk(rid, seq, blob) {
    await tx('chunks', 'readwrite', (t) => promisify(t.objectStore('chunks').put({ rid, seq, blob })));
  },

  async getChunks(rid) {
    const range = IDBKeyRange.bound([rid, 0], [rid, Number.MAX_SAFE_INTEGER]);
    const all = await tx('chunks', 'readonly', (t) => promisify(t.objectStore('chunks').getAll(range)));
    return all.sort((a, b) => a.seq - b.seq);
  },

  async deleteRec(rid) {
    const range = IDBKeyRange.bound([rid, 0], [rid, Number.MAX_SAFE_INTEGER]);
    await tx(['recs', 'chunks'], 'readwrite', (t) => {
      t.objectStore('recs').delete(rid);
      t.objectStore('chunks').delete(range);
    });
  },

  async videoBytes() {
    let total = 0;
    await tx('takes', 'readonly', (t) => {
      return new Promise((resolve, reject) => {
        const req = t.objectStore('takes').openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          total += c.value.size || c.value.blob?.size || 0;
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
    return total;
  },
};

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage?.estimate) return await navigator.storage.estimate();
  } catch {
    /* ignore */
  }
  return null;
}
