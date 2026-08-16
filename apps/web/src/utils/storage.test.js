// Web repoint Card 2 — per-user storage keying.
// Regression guard: the user id used to be decoded from a localStorage JWT.
// httpOnly-cookie sessions (v1 §6.1) killed that, which silently keyed EVERY
// account to 'guest' — including the offline sync queue (syncQueue keys on
// userKey), letting one user's queued workouts flush under another's session.
// The id is now pushed in by AuthContext via setCurrentUserId.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem, getUserId, removeItem, setCurrentUserId, setItem, userKey } from './storage';
import { QUEUE_KEY } from '../sync/syncQueue';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  setCurrentUserId(null); // logged out by default
});

describe('per-user storage keying', () => {
  it('defaults to guest, and adopts / releases the session id', () => {
    expect(getUserId()).toBe('guest');
    expect(userKey('k')).toBe('user_guest_k');

    setCurrentUserId('11111111-1111-4111-8111-111111111111');
    expect(userKey('k')).toBe('user_11111111-1111-4111-8111-111111111111_k');

    setCurrentUserId(null); // logout → next account can't read the last one's data
    expect(userKey('k')).toBe('user_guest_k');
  });

  it('does NOT derive the id from a token (the httpOnly-cookie regression)', () => {
    // A stale token in storage must not influence keying...
    localStorage.setItem('accessToken', 'header.payload.sig');
    expect(getUserId()).toBe('guest');
    // ...and the id works with no token present at all, which is the real case.
    setCurrentUserId('u-42');
    expect(getUserId()).toBe('u-42');
  });

  it('isolates two accounts on one browser (no bucket sharing)', () => {
    setCurrentUserId('user-a');
    setItem('workout_builder', ['a-draft']);

    setCurrentUserId('user-b');
    expect(getItem('workout_builder', null)).toBeNull(); // B cannot see A's draft
    setItem('workout_builder', ['b-draft']);

    setCurrentUserId('user-a');
    expect(getItem('workout_builder', null)).toEqual(['a-draft']); // A's is intact

    removeItem('workout_builder');
    expect(getItem('workout_builder', null)).toBeNull();
    setCurrentUserId('user-b');
    expect(getItem('workout_builder', null)).toEqual(['b-draft']); // B untouched
  });

  it('keeps each account offline sync queue in its own bucket', () => {
    setCurrentUserId('user-a');
    const aQueue = userKey(QUEUE_KEY);
    setCurrentUserId('user-b');
    const bQueue = userKey(QUEUE_KEY);
    expect(aQueue).not.toBe(bQueue);
    // and a logged-out app can never address a real user's queue
    setCurrentUserId(null);
    expect(userKey(QUEUE_KEY)).not.toBe(aQueue);
  });
});

describe('storage helpers never throw at their callers', () => {
  // T3 round 1, L-1. `removeItem` was the only one of the three without a
  // guard, and the dual-write retirement moved `ActiveWorkout`'s two calls out
  // of the try that used to contain them — neither caller awaits or catches
  // `handleWorkoutComplete`, so a throw here becomes an unhandled rejection
  // that skips the navigation to the summary. Storage being unavailable must
  // not be able to strand a finished workout.
  const cases = [
    ['removeItem', () => removeItem('active_session')],
    ['setItem', () => setItem('active_session', { a: 1 })],
    ['getItem', () => getItem('active_session', null)],
  ];

  for (const [name, call] of cases) {
    it(`${name} survives a storage backend that throws`, () => {
      setCurrentUserId('user-a');
      // This suite runs in the NODE environment (vitest.config.js), so there is
      // no `Storage.prototype` to spy on — the global is the fake above. A
      // throwing fake IS the browser case: Safari private mode and a blocked
      // cookie/storage policy both make every method throw, not just setItem.
      const thrower = () => { throw new Error('storage denied'); };
      vi.stubGlobal('localStorage', {
        getItem: thrower, setItem: thrower, removeItem: thrower,
      });
      expect(call).not.toThrow();
    });
  }
});
