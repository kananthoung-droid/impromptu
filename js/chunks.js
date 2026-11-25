// Writes a recording to IndexedDB piece by piece while it is being made.
// - Keeps memory low on long takes (pieces live on disk, not in RAM).
// - If the app crashes or is killed mid-take, the pieces are recovered on next launch.
import { db } from './db.js';

export class ChunkSink {
  constructor(rid, meta) {
    this.rid = rid;
    this.mem = new Map(); // seq -> Blob not (yet) on disk
    this.stored = 0;
    this.failed = false;
    this.lastTouch = 0;
    this.queue = db.putRec({ rid, ...meta, startedAt: Date.now(), updatedAt: Date.now() }).catch((e) => {
      console.warn('chunk store unavailable', e);
      this.failed = true;
    });
    // Hold a lock while recording so another tab never "recovers" a live take.
    this._release = null;
    try {
      navigator.locks?.request(LOCK_PREFIX + rid, () => new Promise((res) => (this._release = res))).catch(() => {});
    } catch {
      /* Web Locks not available */
    }
  }

  releaseLock() {
    this._release?.();
    this._release = null;
  }

  add(seq, blob, elapsedSec = 0) {
    this.mem.set(seq, blob);
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      try {
        await db.putChunk(this.rid, seq, blob);
        this.mem.delete(seq);
        this.stored++;
        const nowTs = Date.now();
        if (nowTs - this.lastTouch > 4000) {
          this.lastTouch = nowTs;
          db.patchRec(this.rid, { updatedAt: nowTs, elapsed: elapsedSec }).catch(() => {});
        }
      } catch (e) {
        // Disk full etc.: keep this and later pieces in memory instead.
        console.warn('chunk write failed', e);
        this.failed = true;
      }
    });
  }

  /** Waits for pending writes and returns the whole recording as one Blob. */
  async assemble(type) {
    await this.queue;
    this.releaseLock();
    const bySeq = new Map();
    if (this.stored) {
      try {
        for (const c of await db.getChunks(this.rid)) bySeq.set(c.seq, c.blob);
      } catch (e) {
        console.warn('reading chunks failed', e);
      }
    }
    for (const [s, b] of this.mem) bySeq.set(s, b);
    const seqs = [...bySeq.keys()].sort((a, b) => a - b);
    return new Blob(
      seqs.map((s) => bySeq.get(s)),
      { type }
    );
  }

  /** Remove the pieces once the finished take is safely stored. */
  async discard() {
    await this.queue.catch(() => {});
    this.releaseLock();
    await db.deleteRec(this.rid).catch(() => {});
  }
}

const LOCK_PREFIX = 'impromptu-rec-';

/**
 * Turn recordings that were interrupted by a crash into normal takes.
 * Returns the number of recovered takes.
 */
export async function recoverInterrupted({ makeTake, minAgeMs = 45000 } = {}) {
  let recs = [];
  try {
    recs = await db.listRecs();
  } catch {
    return 0;
  }
  let held = null;
  try {
    if (navigator.locks?.query) held = new Set(((await navigator.locks.query()).held || []).map((l) => l.name));
  } catch {
    held = null;
  }
  let n = 0;
  for (const r of recs) {
    // Skip a take that is still being recorded (in another tab).
    if (held) {
      if (held.has(LOCK_PREFIX + r.rid)) continue;
    } else if (Date.now() - (r.updatedAt || r.startedAt || 0) < minAgeMs) continue;
    try {
      const chunks = await db.getChunks(r.rid);
      if (!chunks.length) {
        await db.deleteRec(r.rid);
        continue;
      }
      const blob = new Blob(
        chunks.map((c) => c.blob),
        { type: String(r.mimeType || 'video/mp4').split(';')[0] }
      );
      const ok = await makeTake(r, blob);
      if (ok) {
        await db.deleteRec(r.rid);
        n++;
      }
    } catch (e) {
      console.warn('recovery failed', e);
    }
  }
  return n;
}
