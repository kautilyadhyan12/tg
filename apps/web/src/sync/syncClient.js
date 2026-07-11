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
import { workoutSyncPayloadSchema } from '@app/shared';
import { enqueue, flush, park } from './syncQueue';

// Static-bridge defs bundle version (DECISIONS.md 2026-07-10): definitions
// ship as compiled-in package exports until the P2.2 catalog bundle API
// assigns real bundle_version numbers (Part 4 §3.4).
export const STATIC_DEFS_BUNDLE_VERSION = 1;

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
  const payload = {
    workoutId,
    startedAt,
    platform: 'web',
    // Workout-level engineVersion from the first set: versions are homogeneous
    // within one workout today (a single compiled-in engine; the page cannot
    // hot-swap it mid-workout). Per-set engineVersion travels in each summary
    // regardless, so the server loses nothing if that ever changes.
    engineVersion: summaries[0].engineVersion,
    defsVersion: STATIC_DEFS_BUNDLE_VERSION,
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

/** Queue one finished workout for sync and kick a flush. A workout with no
 *  engine summaries (all sets log-only, Part 6 §3.6) has nothing
 *  engine-verified to sync and is skipped — the legacy completeSession call
 *  still records it (DECISIONS.md 2026-07-10). */
export function queueWorkoutSync({ workoutId, startedAt, summaries }) {
  if (!summaries || summaries.length === 0) return { queued: false, reason: 'log-only' };
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

// Flush triggers beyond enqueue-time: app load and connectivity regained.
// (Module-scope by design — this module is bundled with the workout screens;
// guard keeps node-env unit tests import-safe.)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushSyncQueue().catch(() => {});
  });
  flushSyncQueue().catch(() => {});
}
