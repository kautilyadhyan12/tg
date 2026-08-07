// P1.10c — sync-client contract tests: payload byte-matches the shared
// workoutSyncPayloadSchema (v1 §5.3 / Part 2 §2.4 / Part 2 §10 done-gate),
// Idempotency-Key = workoutId (R10.2), offline→sync round trip.
import { describe, it, expect, vi } from 'vitest';
import { ENGINE_VERSION } from '@app/engine';
import { workoutSyncPayloadSchema } from '@app/shared';
import {
  buildSyncPayload, postSync, queueWorkoutSync, flushSyncQueue, STATIC_DEFS_BUNDLE_VERSION,
} from './syncClient';
import { enqueue, flush, peekQueue } from './syncQueue';

// A full §2.4 SetSummary as the engine emits it (all fields, .strict()-clean).
const summary = (setIndex, extra = {}) => ({
  exercise: 'squat',
  setIndex,
  reps: 5,
  durationMs: 21000,
  avgFormScore: 84,
  repScores: [80, 82, 85, 86, 87],
  faultCounts: { shallow_depth: 2 },
  tempoMsAvg: 3900,
  romStats: { kneeMinAvgDeg: 96 },
  view: 'side',
  holdMs: null,
  calibration: null,
  engineVersion: '1.0.0',
  definitionVersion: 1,
  ...extra,
});

// A full §2.4 SetSummary for a set the user counted THEMSELVES: every scoring
// field pinned to its empty value, because nothing watched this set.
const logOnly = (setIndex, extra = {}) => ({
  exercise: 'push_up',
  setIndex,
  reps: 12,
  durationMs: 44000,
  avgFormScore: null,
  repScores: null,
  faultCounts: {},
  tempoMsAvg: null,
  romStats: null,
  view: 'unknown',
  holdMs: null,
  calibration: null,
  mode: 'log_only',
  engineVersion: null,
  definitionVersion: null,
  ...extra,
});

const WORKOUT_ID = 'a3bb189e-8bf9-3888-9912-ace4e6543002';
const STARTED_AT = '2026-07-10T09:30:00.000Z';

const build = (summaries) =>
  buildSyncPayload({ workoutId: WORKOUT_ID, startedAt: STARTED_AT, summaries });

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('buildSyncPayload', () => {
  it('produces a payload the shared contract schema parses byte-identically', () => {
    const built = build([summary(1), summary(2)]);
    expect(built.ok).toBe(true);
    // .strict() parse succeeds AND returns a deep-equal value: nothing added,
    // stripped, or coerced — the queued bytes ARE the contract bytes.
    const parsed = workoutSyncPayloadSchema.parse(built.payload);
    expect(parsed).toEqual(built.payload);
    expect(JSON.stringify(JSON.parse(JSON.stringify(built.payload)))).toBe(
      JSON.stringify(built.payload),
    );
    expect(built.payload.platform).toBe('web');
    expect(built.payload.engineVersion).toBe('1.0.0');
    expect(built.payload.defsVersion).toBe(STATIC_DEFS_BUNDLE_VERSION);
    expect(built.payload.traceSample).toBeNull();
  });

  it('passes NON-contiguous setIndex ordinals through verbatim (manual resets skip numbers)', () => {
    const built = build([summary(1), summary(2), summary(4)]);
    expect(built.ok).toBe(true);
    expect(built.payload.sets.map((s) => s.setIndex)).toEqual([1, 2, 4]);
  });

  it('flags a contract-invalid payload instead of passing it through', () => {
    const built = build([summary(1, { reps: -3 })]);
    expect(built.ok).toBe(false);
    expect(built.error).toBeDefined();
  });

  // The 2026-08-07 Kd-ruled fields: on-screen timer + rest-break counter.
  it('carries durationSeconds and restSeconds when the page supplies them', () => {
    const built = buildSyncPayload({
      workoutId: WORKOUT_ID, startedAt: STARTED_AT, summaries: [summary(1)],
      durationSeconds: 300, restSeconds: 60,
    });
    expect(built.ok).toBe(true);
    expect(built.payload.durationSeconds).toBe(300);
    expect(built.payload.restSeconds).toBe(60);
    expect(workoutSyncPayloadSchema.parse(built.payload)).toEqual(built.payload);
  });

  it('restSeconds 0 is a REAL value (no rest taken) and still travels', () => {
    // Its presence selects the server's v2 formula, so dropping a genuine 0
    // would silently re-price the workout under v1.
    const built = buildSyncPayload({
      workoutId: WORKOUT_ID, startedAt: STARTED_AT, summaries: [summary(1)],
      durationSeconds: 300, restSeconds: 0,
    });
    expect(built.ok).toBe(true);
    expect(built.payload.restSeconds).toBe(0);
  });

  it('omits what it cannot honestly say: 0/absent/fractional timer, absent rest', () => {
    for (const durationSeconds of [undefined, 0, 90.5]) {
      const built = buildSyncPayload({
        workoutId: WORKOUT_ID, startedAt: STARTED_AT, summaries: [summary(1)],
        durationSeconds,
      });
      expect(built.ok).toBe(true);
      expect('durationSeconds' in built.payload).toBe(false);
      expect('restSeconds' in built.payload).toBe(false);
    }
    // The pre-card call shape still builds the pre-card payload byte-for-byte.
    const legacy = build([summary(1)]);
    expect(legacy.ok).toBe(true);
    expect('durationSeconds' in legacy.payload).toBe(false);
    expect('restSeconds' in legacy.payload).toBe(false);
  });

  it('builds a valid payload for a workout where NOTHING was scored', () => {
    // The case that used to be impossible: `summaries[0].engineVersion` on an
    // empty-of-engine-sets list. This is the whole hand-logged write path.
    const built = build([logOnly(1), logOnly(2)]);
    expect(built.ok).toBe(true);
    const parsed = workoutSyncPayloadSchema.parse(built.payload);
    expect(parsed).toEqual(built.payload);
    // The client's own build — a true statement whether or not anything ran.
    expect(built.payload.engineVersion).toBe(ENGINE_VERSION);
    // No bundle was consulted, so no bundle version is claimed.
    expect(built.payload.defsVersion).toBeNull();
    expect(built.payload.sets.map((s) => s.reps)).toEqual([12, 12]);
  });

  it('reports the bundle version when at least one set WAS scored', () => {
    const built = build([summary(1), logOnly(2)]);
    expect(built.ok).toBe(true);
    expect(workoutSyncPayloadSchema.parse(built.payload)).toEqual(built.payload);
    expect(built.payload.defsVersion).toBe(STATIC_DEFS_BUNDLE_VERSION);
  });

  it('names the CLIENT build, not the version a set happens to carry', () => {
    // A set claiming some other engine must not rewrite the workout-level
    // field: it means "the engine build this client was running" (Kd's ruling),
    // which is knowable from the client alone and from nothing else.
    const built = build([summary(1, { engineVersion: '0.0.1' })]);
    expect(built.payload.engineVersion).toBe(ENGINE_VERSION);
  });

  it('rejects a hand-counted set that smuggles a form score', () => {
    // The one claim the feature must never make. Enforced by the shared
    // contract here and by a CHECK constraint at the database.
    const built = build([logOnly(1, { avgFormScore: 100 })]);
    expect(built.ok).toBe(false);
  });
});

describe('postSync', () => {
  it('sends Idempotency-Key = workoutId to POST /v1/workouts/sync', async () => {
    const built = build([summary(1)]);
    const http = { post: vi.fn(async () => ({ status: 200 })) };
    await postSync(built.payload, http);
    const [url, body, config] = http.post.mock.calls[0];
    expect(url).toBe('/v1/workouts/sync');
    expect(body).toBe(built.payload);
    expect(config.headers['Idempotency-Key']).toBe(WORKOUT_ID);
  });
});

describe('flushSyncQueue', () => {
  it('is a no-op (queue untouched, nothing POSTed) when VITE_API_URL is not configured', async () => {
    // The env is STUBBED, not assumed. This test asserted a claim about the
    // runner's environment ("in this node test env VITE_API_URL is unset") that
    // stopped being true the moment a developer put a URL in apps/web/.env —
    // and it then failed locally with `window is not defined`, because the
    // guard never fired and the call reached the queue's browser storage. It
    // passed in CI and failed on Kd's machine, which is the signature of a test
    // that reads its environment instead of setting it.
    vi.stubEnv('VITE_API_URL', '');
    try {
      await expect(flushSyncQueue()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('queueWorkoutSync', () => {
  it('refuses a workout with NO sets at all — the reps have to come from somewhere', () => {
    expect(queueWorkoutSync({ workoutId: WORKOUT_ID, startedAt: STARTED_AT, summaries: [] }))
      .toEqual({ queued: false, reason: 'no-sets' });
  });

  it('refuses the WHOLE workout when an exercise has no catalog row', () => {
    // Partial sync is the worse outcome: the server discards the unknown set
    // and keeps the parent workout, so history would show fewer sets than were
    // done. Refusing leaves the legacy save as one intact record.
    const result = queueWorkoutSync({
      workoutId: WORKOUT_ID,
      startedAt: STARTED_AT,
      summaries: [logOnly(1)],
      unresolved: ['Arnold Shoulder Press'],
    });
    expect(result).toEqual({ queued: false, reason: 'unresolved-exercise' });
  });
});

describe('offline → sync round trip', () => {
  it('queues while offline, retains on failed flush, syncs exactly once when back online — same Idempotency-Key on every attempt', async () => {
    const opts = { storage: fakeStorage(), queueKey: 'q', parkedKey: 'p' };
    const built = build([summary(1), summary(3)]);
    expect(built.ok).toBe(true);
    enqueue(built.payload, opts);

    const keysSent = [];
    let online = false;
    const http = {
      post: vi.fn(async (url, body, config) => {
        keysSent.push(config.headers['Idempotency-Key']);
        if (!online) throw new Error('network down');
        return { status: 200 };
      }),
    };
    const post = (p) => postSync(p, http);

    await flush(post, opts); // offline attempt
    expect(peekQueue(opts)).toHaveLength(1); // retained, not dropped

    online = true;
    await flush(post, opts);
    expect(peekQueue(opts)).toEqual([]); // synced
    await flush(post, opts); // extra flush: nothing left to send
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(keysSent).toEqual([WORKOUT_ID, WORKOUT_ID]);
    // The successful body is byte-identical to what was queued.
    expect(http.post.mock.calls[1][1]).toEqual(built.payload);
  });
});
