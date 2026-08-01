// P1.10c — sync client: POST /v1/workouts/sync against the NEW api
// (v1 §5.3; Part 4 §3.5 upsert contract; server route lands in P1.10d).
//
// Auth style is httpOnly-cookie (R10.1): withCredentials only — deliberately
// NOT the salvage mlApi instance, whose interceptors inject a localStorage
// bearer token and hard-redirect to /login on 401. A 401 here is a transient
// queue outcome (retry after re-auth), never a navigation.
//
// Retries happen ONLY through the queue, so every retry carries the same
// Idempotency-Key = workoutId (R10.2/R3.5); axios itself never auto-retries.

import axios from 'axios';
import { ENGINE_VERSION } from '@app/engine';
import { workoutSyncPayloadSchema } from '@app/shared';
import { enqueue, flush, park } from './syncQueue';

// Static-bridge defs bundle version (DECISIONS.md 2026-07-10): definitions
// ship as compiled-in package exports until the P2.2 catalog bundle API
// assigns real bundle_version numbers (Part 4 §3.4).
export const STATIC_DEFS_BUNDLE_VERSION = 1;

/** True if any set in this workout was actually analysed by the engine.
 *  `mode` is OPTIONAL on the engine arm of the contract (older clients omit
 *  it), so the test is "not log_only" rather than "=== 'engine'" — reading it
 *  the other way would call every pre-log-only-card payload hand-counted. */
function hasEngineSet(summaries) {
  return summaries.some((s) => s?.mode !== 'log_only');
}

const syncApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/** Shape one workout's collected §2.4 SetSummaries into the v1 §5.3 sync
 *  payload and validate it against the shared contract schema. Summaries pass
 *  through VERBATIM — setIndex is an opaque, NON-contiguous workout ordinal
 *  (manual resets skip numbers) and must never be renumbered. */
export function buildSyncPayload({ workoutId, startedAt, summaries }) {
  const engineRan = hasEngineSet(summaries);
  const payload = {
    workoutId,
    startedAt,
    platform: 'web',
    // THE ENGINE BUILD THIS CLIENT WAS RUNNING — not "the engine that scored
    // this workout" (Kd ruled option A, 2026-08-01). Read the old way this
    // field was copied off `summaries[0]`, which is undefined for a workout
    // where nothing was scored: the write path would have had to invent a
    // version or crash. Read the ruled way it is a true statement about the
    // app, knowable either way, and per-set provenance is where "what scored
    // this set" lives — nullable there, precisely so it can say "nothing did".
    engineVersion: ENGINE_VERSION,
    // NULL when no set was analysed: no definition bundle was consulted, so
    // there is no bundle version to report and `1` would name a bundle that
    // did nothing here. The column has always allowed null (Part 4 §3.5).
    defsVersion: engineRan ? STATIC_DEFS_BUNDLE_VERSION : null,
    sets: summaries,
    traceSample: null,
  };
  const result = workoutSyncPayloadSchema.safeParse(payload);
  if (!result.success) return { ok: false, payload, error: result.error };
  return { ok: true, payload };
}

/** POST one payload. `http` is injectable for tests. */
export function postSync(payload, http = syncApi) {
  return http.post('/v1/workouts/sync', payload, {
    headers: { 'Idempotency-Key': payload.workoutId },
  });
}

/** Flush everything queued (fire-and-forget safe: flush never rejects on
 *  transient failures, it just leaves the queue intact). With no VITE_API_URL
 *  configured (pre-P1.10d dev, misdeployed env) there is no sync API — the
 *  POST would hit the web origin itself and its 404 would PARK every workout
 *  permanently (T3 P1.10c finding). Treat that as offline: skip, keep queue. */
export function flushSyncQueue() {
  if (!import.meta.env.VITE_API_URL) return Promise.resolve();
  return flush((payload) => postSync(payload));
}

/** Queue one finished workout for sync and kick a flush.
 *
 *  HAND-COUNTED WORKOUTS ARE SYNCED (web write path, 2026-08-02). This function
 *  used to refuse any workout with no engine summaries, which was right while
 *  log-only sets could not be expressed on the wire at all and the legacy save
 *  was their only home — and became a data-loss hole the moment that backend is
 *  switched off, since only 3 of the 58 catalog exercises have a definition.
 *  Log-only sets are expressible now, so "nothing engine-verified to send" is no
 *  longer the same statement as "nothing to send".
 *
 *  `unresolved` carries display names with no catalog row. The server DISCARDS
 *  a set whose slug it does not know while still inserting the parent workout —
 *  so syncing one anyway writes a workout with fewer sets than the user did, or
 *  none at all. Refusing the whole workout keeps the legacy save as its single
 *  intact record instead of splitting it across two systems, neither complete.
 *  It cannot happen today (all 58 library names resolve — asserted in
 *  activeWorkoutEngine.test.js); it is the guard for the 59th. */
export function queueWorkoutSync({ workoutId, startedAt, summaries, unresolved = [] }) {
  if (!summaries || summaries.length === 0) return { queued: false, reason: 'no-sets' };
  if (unresolved.length > 0) {
    console.error(
      'workout NOT synced — exercise missing from the catalog:',
      unresolved.join(', '),
    );
    return { queued: false, reason: 'unresolved-exercise' };
  }
  const built = buildSyncPayload({ workoutId, startedAt, summaries });
  if (!built.ok) {
    // A payload our own engine produced failing our own contract is a
    // programming error; park it (kept, inspectable — R10.3) instead of
    // letting it poison the queue or silently vanish. Log issue paths/codes
    // only, not the received values.
    console.error(
      'sync payload failed contract validation — parked:',
      built.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    );
    park(built.payload);
    return { queued: false, reason: 'invalid' };
  }
  if (!enqueue(built.payload)) return { queued: false, reason: 'storage' };
  flushSyncQueue().catch((err) => console.error('sync flush error:', err));
  return { queued: true };
}

// Flush trigger beyond enqueue-time: connectivity regained. (Module-scope;
// AuthContext imports this module, so the listener registers on every page —
// the guard keeps node-env unit tests import-safe.)
//
// The app-load flush USED to fire here at import time. That worked only while
// the user id was decodable synchronously from a localStorage JWT: the queue is
// keyed per-user (syncQueue → storage.userKey), and after the web repoint the id
// arrives asynchronously from /v1/auth/me (httpOnly cookies, v1 §6.1). Flushing
// at import would therefore read the 'guest' bucket and silently never flush the
// signed-in user's queued workouts. AuthContext kicks the app-load flush once
// the id is known — NOT equivalent to the old trigger: if /v1/auth/me fails at
// app load the flush does not run at all this page-session (accepted; DECISIONS
// 2026-07-15 — a liveness delay, never data loss: the queue is untouched and any
// later reload/login flushes it).
// The 'online' listener stays. Pre-auth it can only address the (empty) guest
// bucket, and flushRun binds each run to its owner, so it can never send one
// user's queue under another's cookie.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushSyncQueue().catch(() => {});
  });
}
