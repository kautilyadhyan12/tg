// P1.10c — sync-client contract tests: payload byte-matches the shared
// workoutSyncPayloadSchema (v1 §5.3 / Part 2 §2.4 / Part 2 §10 done-gate),
// Idempotency-Key = workoutId (R10.2), offline→sync round trip.
import { describe, it, expect, vi } from 'vitest';
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
    // In this node test env VITE_API_URL is unset — exactly the pre-P1.10d
    // state. Without the guard this call would reach the queue's browser
    // storage (and, in a browser, POST to the web origin and park on its 404).
    await expect(flushSyncQueue()).resolves.toBeUndefined();
  });
});

describe('queueWorkoutSync', () => {
  it('skips an all-log-only workout (no engine summaries)', () => {
    expect(queueWorkoutSync({ workoutId: WORKOUT_ID, startedAt: STARTED_AT, summaries: [] }))
      .toEqual({ queued: false, reason: 'log-only' });
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
