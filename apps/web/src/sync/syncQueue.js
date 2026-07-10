// P1.10c — offline workout-sync queue (R10.3: flush order preserved; a failed
// flush never drops or duplicates a workout). Storage is localStorage under
// the app's per-user key convention; both the storage object and the keys are
// injectable so the logic is unit-testable in a node environment.
//
// Retry policy (DECISIONS.md 2026-07-10): transient failures — network errors,
// 5xx, 401 (re-auth later), 408, 429 — retain the entry and HALT the flush so
// later workouts never jump ahead of an unsynced earlier one. Any other 4xx is
// permanent (the server has rejected this exact payload; retrying is a poison
// pill): the entry moves to a parked list — still in localStorage, never
// dropped (R10.3) — and the flush continues.

import { userKey } from '../utils/storage';

export const QUEUE_KEY = 'workout_sync_queue.v1';
export const PARKED_KEY = 'workout_sync_parked.v1';

// Per-field lazy defaults: window/localStorage are only touched for fields
// the caller did NOT inject (node-env tests inject all three).
const resolveOpts = (opts) => ({
  storage: opts.storage ?? window.localStorage,
  queueKey: opts.queueKey ?? userKey(QUEUE_KEY),
  parkedKey: opts.parkedKey ?? userKey(PARKED_KEY),
});

function readList(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt storage: treat as empty rather than crash the app. (The corrupt
    // blob itself is unrecoverable either way; healthy entries live inside the
    // same array, so per-entry salvage isn't possible past JSON.parse.)
    return [];
  }
}

/** Returns false when the write failed (e.g. quota) — callers must not report
 *  success for a payload that never reached storage (T3 P1.10c finding). */
function writeList(storage, key, list) {
  try {
    storage.setItem(key, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('sync queue storage error:', err);
    return false;
  }
}

function upsertById(list, payload) {
  const i = list.findIndex((p) => p.workoutId === payload.workoutId);
  if (i >= 0) list[i] = payload;
  else list.push(payload);
  return list;
}

/** Add a payload to the queue, keyed by workoutId: an existing entry with the
 *  same workoutId is REPLACED IN PLACE (same position — never a duplicate,
 *  never a reorder). Returns false if the storage write failed. */
export function enqueue(payload, opts = {}) {
  const { storage, queueKey } = resolveOpts(opts);
  const queue = upsertById(readList(storage, queueKey), payload);
  return writeList(storage, queueKey, queue);
}

/** Move a payload straight to the parked list (payloads that failed schema
 *  validation, or were permanently rejected by the server — kept, not
 *  dropped). Same-workoutId replace-in-place, like enqueue. */
export function park(payload, opts = {}) {
  const { storage, parkedKey } = resolveOpts(opts);
  const parked = upsertById(readList(storage, parkedKey), payload);
  return writeList(storage, parkedKey, parked);
}

/** Move every parked payload back onto the end of the queue (recovery path —
 *  e.g. after a server bug that 4xx'd valid payloads is fixed; callable from
 *  the console in dev). Parked order preserved; same-workoutId entries replace
 *  their queued version in place. */
export function requeueParked(opts = {}) {
  const { storage, queueKey, parkedKey } = resolveOpts(opts);
  const parked = readList(storage, parkedKey);
  if (parked.length === 0) return 0;
  const queue = readList(storage, queueKey);
  for (const p of parked) upsertById(queue, p);
  if (!writeList(storage, queueKey, queue)) return 0;
  writeList(storage, parkedKey, []);
  return parked.length;
}

/** Read the current queue / parked list (debug + tests). */
export function peekQueue(opts = {}) {
  const { storage, queueKey } = resolveOpts(opts);
  return readList(storage, queueKey);
}
export function peekParked(opts = {}) {
  const { storage, parkedKey } = resolveOpts(opts);
  return readList(storage, parkedKey);
}

function isPermanentRejection(err) {
  const status = err?.response?.status;
  if (typeof status !== 'number') return false; // network error → transient
  if (status === 401 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

function removeFromQueue(storage, queueKey, sentEntry) {
  // Re-read before writing: enqueue() may have run while the POST was in
  // flight; filtering a fresh read never clobbers a concurrently added entry.
  // Remove only if the stored payload is still the one we actually sent —
  // an in-place replacement during the POST must survive to be sent next run
  // (T3 P1.10c TOCTOU finding). Stored entries are fresh JSON.parse results,
  // so equality is by serialized bytes, not reference.
  const sentBytes = JSON.stringify(sentEntry);
  const queue = readList(storage, queueKey);
  const kept = queue.filter(
    (p) => p.workoutId !== sentEntry.workoutId || JSON.stringify(p) !== sentBytes,
  );
  if (kept.some((p) => p.workoutId === sentEntry.workoutId)) {
    // A replacement version of this workout survived the filter — make sure
    // the current flush takes another pass so it is sent, not stranded.
    rerunRequested = true;
  }
  writeList(storage, queueKey, kept);
}

let inFlight = null;
let rerunRequested = false;

/** Flush the queue in order via `post(payload)` (async, resolves on 2xx,
 *  rejects otherwise). An entry is removed ONLY after its POST succeeded.
 *  Transient failure → entry retained, flush halts. Permanent 4xx → entry
 *  parked, flush continues. Concurrent calls share one in-flight run; a call
 *  that arrives mid-run (e.g. enqueue during the online-event flush) requests
 *  one follow-up pass so a just-added workout is never stranded until the
 *  next trigger (T3 P1.10c liveness finding). */
export function flush(post, opts = {}) {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      rerunRequested = false;
      await flushRun(post, opts);
    } while (rerunRequested);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function flushRun(post, opts) {
  const { storage, queueKey, parkedKey } = resolveOpts(opts);
  // Snapshot of workoutIds to attempt in this run, in order; each payload is
  // re-read fresh at send time so a replaced entry sends its latest version.
  const order = readList(storage, queueKey).map((p) => p.workoutId);
  for (const workoutId of order) {
    const entry = readList(storage, queueKey).find((p) => p.workoutId === workoutId);
    if (!entry) continue;
    try {
      await post(entry);
      removeFromQueue(storage, queueKey, entry);
    } catch (err) {
      if (isPermanentRejection(err)) {
        console.error('workout sync permanently rejected — parked:', workoutId, err?.response?.status);
        park(entry, { storage, parkedKey });
        removeFromQueue(storage, queueKey, entry);
        continue;
      }
      return; // transient: keep the entry, halt — order preserved
    }
  }
}
