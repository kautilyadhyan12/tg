// P1.10c — queue-integrity tests (R10.3: order preserved, a failed flush
// never drops or duplicates a workout). Node env: storage + keys injected.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueue, flush, park, peekQueue, peekParked, requeueParked } from './syncQueue';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const payload = (id, extra = {}) => ({ workoutId: id, platform: 'web', ...extra });

let storage;
let opts;
beforeEach(() => {
  storage = fakeStorage();
  opts = { storage, queueKey: 'q', parkedKey: 'p' };
});

const httpError = (status) => Object.assign(new Error(`http ${status}`), { response: { status } });

describe('enqueue', () => {
  it('preserves FIFO order', () => {
    enqueue(payload('a'), opts);
    enqueue(payload('b'), opts);
    enqueue(payload('c'), opts);
    expect(peekQueue(opts).map((p) => p.workoutId)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a duplicate workoutId in place — never duplicates or reorders', () => {
    enqueue(payload('a', { v: 1 }), opts);
    enqueue(payload('b'), opts);
    enqueue(payload('a', { v: 2 }), opts);
    const q = peekQueue(opts);
    expect(q.map((p) => p.workoutId)).toEqual(['a', 'b']);
    expect(q[0].v).toBe(2);
  });

  it('returns false when the storage write fails (quota) — caller must not claim success', () => {
    const full = {
      ...storage,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(enqueue(payload('a'), { ...opts, storage: full })).toBe(false);
    expect(enqueue(payload('a'), opts)).toBe(true);
  });

  it('recovers from corrupted storage without throwing', () => {
    storage.setItem('q', '{not json!!');
    expect(() => enqueue(payload('a'), opts)).not.toThrow();
    expect(peekQueue(opts).map((p) => p.workoutId)).toEqual(['a']);
  });
});

describe('flush', () => {
  it('posts in order and removes each entry only after success', async () => {
    enqueue(payload('a'), opts);
    enqueue(payload('b'), opts);
    const sent = [];
    await flush(async (p) => sent.push(p.workoutId), opts);
    expect(sent).toEqual(['a', 'b']);
    expect(peekQueue(opts)).toEqual([]);
  });

  it('transient failure retains the entry and HALTS — later entries never jump ahead', async () => {
    enqueue(payload('a'), opts);
    enqueue(payload('b'), opts);
    enqueue(payload('c'), opts);
    const post = vi.fn(async (p) => {
      if (p.workoutId === 'b') throw httpError(503);
    });
    await flush(post, opts);
    expect(post.mock.calls.map(([p]) => p.workoutId)).toEqual(['a', 'b']); // c never attempted
    expect(peekQueue(opts).map((p) => p.workoutId)).toEqual(['b', 'c']);
  });

  it('network error (no response) is transient', async () => {
    enqueue(payload('a'), opts);
    await flush(async () => { throw new Error('network down'); }, opts);
    expect(peekQueue(opts).map((p) => p.workoutId)).toEqual(['a']);
  });

  it('401/408/429 are transient (retain + halt)', async () => {
    for (const status of [401, 408, 429]) {
      const o = { storage: fakeStorage(), queueKey: 'q', parkedKey: 'p' };
      enqueue(payload('a'), o);
      await flush(async () => { throw httpError(status); }, o);
      expect(peekQueue(o).map((p) => p.workoutId)).toEqual(['a']);
      expect(peekParked(o)).toEqual([]);
    }
  });

  it('permanent 4xx parks the entry (never dropped) and continues', async () => {
    enqueue(payload('a'), opts);
    enqueue(payload('b'), opts);
    const post = vi.fn(async (p) => {
      if (p.workoutId === 'a') throw httpError(422);
    });
    await flush(post, opts);
    expect(peekQueue(opts)).toEqual([]); // b flushed after a was parked
    expect(peekParked(opts).map((p) => p.workoutId)).toEqual(['a']);
    expect(post.mock.calls.map(([p]) => p.workoutId)).toEqual(['a', 'b']);
  });

  it('retry after failure yields exactly one successful POST — no drop, no duplicate', async () => {
    enqueue(payload('a'), opts);
    let fail = true;
    const post = vi.fn(async () => {
      if (fail) throw httpError(500);
    });
    await flush(post, opts);
    expect(peekQueue(opts)).toHaveLength(1); // retained
    fail = false;
    await flush(post, opts);
    expect(peekQueue(opts)).toEqual([]); // synced once
    expect(post).toHaveBeenCalledTimes(2); // 1 failed + 1 successful, same payload
    expect(post.mock.calls[0][0]).toEqual(post.mock.calls[1][0]);
  });

  it('concurrent flush calls share one in-flight run (no double-POST)', async () => {
    enqueue(payload('a'), opts);
    let release;
    const gate = new Promise((r) => { release = r; });
    const post = vi.fn(async () => { await gate; });
    const f1 = flush(post, opts);
    const f2 = flush(post, opts); // must join f1, not start over
    release();
    await Promise.all([f1, f2]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(peekQueue(opts)).toEqual([]);
  });

  it('an entry enqueued MID-flush is sent by a follow-up pass, not stranded', async () => {
    enqueue(payload('a'), opts);
    let release;
    const gate = new Promise((r) => { release = r; });
    const sent = [];
    const post = vi.fn(async (p) => {
      sent.push(p.workoutId);
      if (p.workoutId === 'a') await gate;
    });
    const f1 = flush(post, opts);
    enqueue(payload('b'), opts); // arrives while a's POST is in flight
    const f2 = flush(post, opts); // joins f1 but requests a rerun
    release();
    await Promise.all([f1, f2]);
    expect(sent).toEqual(['a', 'b']); // b synced in the same flush call
    expect(peekQueue(opts)).toEqual([]);
  });

  it('a payload replaced while its old version is in flight survives to be re-sent', async () => {
    enqueue(payload('a', { v: 1 }), opts);
    let release;
    const gate = new Promise((r) => { release = r; });
    const post = vi.fn(async (p) => {
      if (p.v === 1) await gate; // old version in flight...
    });
    const f = flush(post, opts);
    enqueue(payload('a', { v: 2 }), opts); // ...replaced meanwhile
    release();
    await f; // success-removal must NOT delete v2 unsent; rerun sends it
    expect(post.mock.calls.map(([p]) => p.v)).toEqual([1, 2]);
    expect(peekQueue(opts)).toEqual([]);
  });
});

describe('park', () => {
  it('keeps a payload without duplicating it; a newer same-id payload replaces in place', () => {
    park(payload('a', { v: 1 }), opts);
    park(payload('b'), opts);
    park(payload('a', { v: 2 }), opts);
    const parked = peekParked(opts);
    expect(parked.map((p) => p.workoutId)).toEqual(['a', 'b']);
    expect(parked[0].v).toBe(2);
  });
});

describe('requeueParked', () => {
  it('moves parked entries back onto the queue (order kept, parked list emptied)', () => {
    enqueue(payload('q1'), opts);
    park(payload('a'), opts);
    park(payload('b'), opts);
    expect(requeueParked(opts)).toBe(2);
    expect(peekQueue(opts).map((p) => p.workoutId)).toEqual(['q1', 'a', 'b']);
    expect(peekParked(opts)).toEqual([]);
    expect(requeueParked(opts)).toBe(0); // idempotent on empty
  });
});
