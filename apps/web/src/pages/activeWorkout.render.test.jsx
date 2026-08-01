// RENDER tests for the HAND-COUNTED workout write path.
//
// WHY THIS FILE EXISTS, and why the unit tests next door are not enough.
// `buildLogOnlySet` can be perfect and this feature can still record every set
// as 0 reps, or as one rep short, because the defect lives in WHICH VALUE the
// page hands it. The rep count is React state read from inside a memoized
// callback that stays pinned to an early render; the fix is a ref assigned on
// the same line as the state setter. A unit test cannot see any of that — it
// calls the builder with the right number and watches it do the right thing.
//
// So these tests drive the real page: tap "+1 Rep" a real number of times and
// read what actually reached the sync queue. The two failure modes this file
// exists for are:
//
//   reps: 0   — the recorded trap (no ref at all; the callback reads a
//               mount-time snapshot).
//   reps: N-1 — the trap inside the trap. The set-end path runs in the SAME
//               TICK as the last rep, so a ref mirrored in an effect is still
//               one behind. The screen says 12 and the database says 11, which
//               is the version nobody notices.
//
// Nothing here mocks the sync client, the queue or the contract — the payload
// that lands in localStorage is the payload that would be POSTed. Only the
// camera, the pose hook and the old backend are stubbed, because a test cannot
// hold a webcam.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const startCamera = vi.fn(async () => null);
vi.mock('../hooks/useCamera', () => ({
  default: () => ({
    videoRef: { current: null },
    stream: null,
    error: null,
    startCamera,
    stopCamera: vi.fn(),
  }),
}));

// analysisAvailable: false is the ordinary case — 55 of the 58 catalog
// exercises have no definition. It is CONFIGURABLE rather than hardcoded so the
// engine-active path can be rendered too: with it pinned false, the gate that
// keeps the hand-counted capture out of the engine's way could be deleted
// without a single test noticing. T3 round 1, F2.
let poseState = { poseData: null, analysisAvailable: false };
vi.mock('../hooks/usePoseDetection', () => ({
  default: () => ({
    poseData: poseState.poseData,
    keypointsData: null,
    analysisAvailable: poseState.analysisAvailable,
    error: null,
    startStreaming: vi.fn(),
    stop: vi.fn(),
  }),
}));

const completeSession = vi.fn(async () => ({ data: {} }));
vi.mock('../api/workoutApi', () => ({
  workoutService: { completeSession: (...a) => completeSession(...a) },
}));

// The real set-builder, with one seam: a flag that makes recording throw, so
// the "a failure here cannot break the workout" guarantee can be exercised
// rather than asserted. Every other test runs the genuine implementation.
let recordThrows = false;
vi.mock('./activeWorkoutEngine', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    recordLogOnlySet: (...args) => {
      if (recordThrows) throw new Error('recording blew up');
      return actual.recordLogOnlySet(...args);
    },
  };
});

// Speech synthesis does not exist in jsdom and is not what is under test.
vi.mock('../utils/voice', () => ({
  speakExercise: vi.fn(),
  speakCorrection: vi.fn(),
  speakProgress: vi.fn(),
  speakRest: vi.fn(),
  speakSetStart: vi.fn(),
  speakComplete: vi.fn(),
  setVoiceEnabled: vi.fn(),
}));

import ActiveWorkout from './ActiveWorkout';
import { setItem } from '../utils/storage';
import { peekQueue } from '../sync/syncQueue';

const exercise = (over = {}) => ({
  id: 'e1',
  name: 'Push-ups',
  sets: 1,
  reps: 3,
  rest: 60,
  ...over,
});

function startWorkout(exercises) {
  setItem('active_session', { sessionId: 's1', exercises, name: 'My Workout' });
  return render(
    <MemoryRouter>
      <ActiveWorkout />
    </MemoryRouter>,
  );
}

const tapRep = () => fireEvent.click(screen.getByText('+1 Rep'));

/** The one workout the queue holds, or undefined. */
const queued = () => peekQueue()[0];

const realNow = Date.now.bind(Date);
let clockOffset = 0;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  recordThrows = false;
  poseState = { poseData: null, analysisAvailable: false };
  // An OFFSET on the real clock, not a frozen one: testing-library's waiting
  // needs time to actually pass, so a fully fake clock would deadlock. Tests
  // that care about durations move `clockOffset` and read what was recorded.
  clockOffset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
  // No API URL ⇒ flushSyncQueue is a no-op, so the payload stays in the queue
  // where this test can read it instead of being POSTed at a real host.
  vi.stubEnv('VITE_API_URL', '');
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!globalThis.crypto?.randomUUID) {
    globalThis.crypto = {
      ...globalThis.crypto,
      randomUUID: () => 'a3bb189e-8bf9-3888-9912-ace4e6543002',
    };
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a hand-counted workout reaches the new API', () => {
  it('sends the number of reps the user actually tapped', async () => {
    startWorkout([exercise({ reps: 3 })]);

    tapRep();
    tapRep();
    expect(screen.getByText('2')).toBeTruthy(); // on screen, mid-set
    tapRep(); // hits the target → set ends → workout ends, all in this tick

    await waitFor(() => expect(queued()).toBeDefined());
    const payload = queued();
    expect(payload.sets).toHaveLength(1);
    // 3, not 0 (no live copy) and not 2 (a live copy updated one tick late).
    expect(payload.sets[0].reps).toBe(3);
    expect(payload.sets[0].exercise).toBe('push_up');
    expect(payload.sets[0].mode).toBe('log_only');
  });

  it('sends a set ended EARLY by the Complete Set button, with the reps done so far', async () => {
    startWorkout([exercise({ reps: 20 })]); // target the user will not reach

    tapRep();
    tapRep();
    fireEvent.click(screen.getByText('Complete Set ✓'));

    await waitFor(() => expect(queued()).toBeDefined());
    expect(queued().sets[0].reps).toBe(2);
  });

  it('files each set under its own ordinal across a multi-set workout', async () => {
    // Two sets of one rep. The second must not overwrite the first — which is
    // exactly what happens if the set ordinal is read from a stale render:
    // both sets arrive as setIndex 1, the contract's duplicate check rejects
    // the payload, and the whole workout is parked instead of stored.
    //
    // Rest is SKIPPED rather than waited out. The rest screen is an overlay and
    // the workout controls stay in the DOM underneath it, so "wait until the
    // rep button is back" is satisfied instantly, mid-rest — a wait that does
    // not wait. (Learned here: it made this test tap during rest and then hang.)
    startWorkout([exercise({ sets: 2, reps: 1 })]);

    tapRep(); // set 1 done → rest
    await waitFor(() => expect(screen.getByText('Skip Rest →')).toBeTruthy());

    // Jump the clock forward an hour DURING the rest. Real time keeps flowing
    // underneath (so waitFor still works) — this only offsets it. Set 2's clock
    // must start after the jump, so its duration stays seconds. A set clock
    // that never restarts would measure from the start of the WORKOUT and
    // report the whole hour, which is the assertion below.
    clockOffset = 3_600_000;
    fireEvent.click(screen.getByText('Skip Rest →'));

    await waitFor(() => expect(screen.queryByText('Skip Rest →')).toBeNull());
    // Set 2 now takes a known five seconds, so its duration can be asserted as
    // a MEASUREMENT rather than merely "not the whole hour". A clock that never
    // starts reports 0 and passes a not-the-whole-hour check — which is exactly
    // what the mutation run caught, after the first version of this test.
    clockOffset = 3_600_000 + 5_000;
    tapRep(); // set 2 done → workout done

    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const sets = queued().sets;
    expect(sets).toHaveLength(2);
    expect(sets.map((s) => s.setIndex)).toEqual([1, 2]);
    expect(sets.every((s) => s.reps === 1)).toBe(true);
    // Each set timed ITSELF. Set 2 ran for the five seconds put on the clock
    // above: not 0 (a clock that never started) and not an hour and five
    // seconds (a clock that started once, at the top of the workout).
    expect(sets[1].durationMs).toBeGreaterThanOrEqual(5_000);
    expect(sets[1].durationMs).toBeLessThan(60_000);
    expect(sets[0].durationMs).toBeLessThan(60_000);
  });

  it('gives every set a duration, because the contract requires one', async () => {
    startWorkout([exercise({ reps: 1 })]);
    tapRep();

    await waitFor(() => expect(queued()).toBeDefined());
    const { durationMs } = queued().sets[0];
    expect(typeof durationMs).toBe('number');
    expect(Number.isInteger(durationMs)).toBe(true);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('does not send a set the user never started', async () => {
    // Complete Set with zero reps: nothing happened, so nothing is recorded —
    // and with no sets at all the workout is not queued.
    startWorkout([exercise({ reps: 5 })]);
    fireEvent.click(screen.getByText('Complete Set ✓'));

    await waitFor(() => expect(completeSession).toHaveBeenCalled());
    expect(peekQueue()).toEqual([]);
  });

  it('a redone set sends the reps done AFTER the reset, not before', async () => {
    startWorkout([exercise({ reps: 10 })]);

    tapRep();
    tapRep();
    fireEvent.click(screen.getByLabelText('Reset reps for this set'));
    tapRep();
    fireEvent.click(screen.getByText('Complete Set ✓'));

    await waitFor(() => expect(queued()).toBeDefined());
    expect(queued().sets[0].reps).toBe(1);
  });

  it('still saves to the old backend — the new write path is in ADDITION', async () => {
    // The legacy save is what the summary screen, the dashboard stats and the
    // calendar still read. Dropping it would print a "+50 XP" that was never
    // awarded. Replacement before removal.
    startWorkout([exercise({ reps: 1 })]);
    tapRep();

    await waitFor(() => expect(completeSession).toHaveBeenCalledTimes(1));
    expect(completeSession.mock.calls[0][0]).toBe('s1');
  });

  it('does not sync — but still saves and still finishes — when an exercise is not in the catalog', async () => {
    // The server discards a set whose slug it does not know while keeping the
    // parent workout, so a partial sync writes a workout with sets missing.
    // Refusing keeps the legacy save as one intact record.
    startWorkout([exercise({ name: 'Arnold Shoulder Press', reps: 1 })]);
    tapRep();

    await waitFor(() => expect(completeSession).toHaveBeenCalled());
    expect(peekQueue()).toEqual([]);
  });

  it('refuses the WHOLE workout when only ONE of its exercises is uncatalogued', async () => {
    // The case the guard actually exists for, and the one the test above
    // cannot see: with a good set present the workout WOULD queue, carrying
    // fewer sets than the user performed. A mutation proved the point — cutting
    // the wiring between the page and the sync client left the test above
    // green, because a workout with no sendable sets is refused for a
    // different reason entirely.
    startWorkout([
      exercise({ name: 'Push-ups', reps: 1 }),
      exercise({ id: 'e2', name: 'Arnold Shoulder Press', reps: 1 }),
    ]);

    tapRep(); // Push-ups done → rest → next exercise
    await waitFor(() => expect(screen.getByText('Skip Rest →')).toBeTruthy());
    fireEvent.click(screen.getByText('Skip Rest →'));
    await waitFor(() => expect(screen.queryByText('Skip Rest →')).toBeNull());
    tapRep(); // the uncatalogued one → workout done

    await waitFor(() => expect(completeSession).toHaveBeenCalled());
    expect(peekQueue()).toEqual([]);
  });

  it('keeps the reps already done when Skip Exercise ends a set early', async () => {
    // THE FOURTH set-end path, and the one that does NOT go through
    // handleSetComplete. A camera-graded part-set is recorded when the exercise
    // is skipped, so a hand-counted one must be too — otherwise reps vanish or
    // survive depending only on which exercise the user picked.
    //
    // This test exists because a review deleted that one capture call and all
    // 302 tests stayed green while a whole part-set disappeared. T3 round 1, F1.
    startWorkout([
      exercise({ name: 'Push-ups', reps: 10 }), // a target the user will not reach
      exercise({ id: 'e2', name: 'Plank', reps: 1 }),
    ]);

    tapRep();
    tapRep(); // 2 of 10 done...
    clockOffset = 3_600_000; // an hour on the first exercise
    fireEvent.click(screen.getByText('Skip Exercise')); // ...then abandoned
    await waitFor(() => expect(screen.queryByText('Skip Rest →')).toBeNull());
    clockOffset = 3_600_000 + 3_000;
    tapRep(); // finish the second exercise → workout ends

    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const sets = queued().sets;
    expect(sets.map((s) => s.exercise)).toEqual(['push_up', 'plank']);
    expect(sets[0].reps).toBe(2); // the abandoned part-set, kept
    // The next exercise's clock restarted with it, rather than reporting the
    // hour spent on the one before. T3 round 2, F-4/N5.
    expect(sets[1].durationMs).toBeGreaterThanOrEqual(3_000);
    expect(sets[1].durationMs).toBeLessThan(60_000);
  });

  it('a set the user never touched does not inherit the previous set\'s reps', async () => {
    // Every set-START reset was unpinned: every other test taps at least once,
    // which overwrites the live rep copy and hides a missing reset. Here set 2
    // gets ZERO taps, so a stale copy would file it with set 1's count — a
    // wrong row in history that nobody performed. T3 round 2, F-4/N7-N9.
    startWorkout([exercise({ sets: 2, reps: 10 })]);

    tapRep();
    tapRep(); // set 1: 2 reps
    fireEvent.click(screen.getByText('Complete Set ✓'));
    await waitFor(() => expect(screen.getByText('Skip Rest →')).toBeTruthy());
    fireEvent.click(screen.getByText('Skip Rest →'));
    await waitFor(() => expect(screen.queryByText('Skip Rest →')).toBeNull());

    fireEvent.click(screen.getByText('Complete Set ✓')); // set 2: nothing done

    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const sets = queued().sets;
    expect(sets).toHaveLength(1);      // set 2 dropped, not invented
    expect(sets[0].setIndex).toBe(1);
    expect(sets[0].reps).toBe(2);
  });

  it('a redone set times itself from the redo, not from the abandoned attempt', async () => {
    // The set clock must restart with the reps. T3 round 2, F-4/N4.
    startWorkout([exercise({ reps: 10 })]);

    tapRep();
    clockOffset = 3_600_000; // an hour of fumbling before giving up on the set
    fireEvent.click(screen.getByLabelText('Reset reps for this set'));
    clockOffset = 3_600_000 + 4_000;
    tapRep();
    fireEvent.click(screen.getByText('Complete Set ✓'));

    await waitFor(() => expect(queued()).toBeDefined());
    const { reps, durationMs } = queued().sets[0];
    expect(reps).toBe(1);
    expect(durationMs).toBeGreaterThanOrEqual(4_000);
    expect(durationMs).toBeLessThan(60_000); // not the abandoned hour
  });

  it('files nothing itself when the engine is analysing the set', async () => {
    // The engine emits that set's summary on its own teardown. If the page
    // filed one too, both would claim the same set number, the contract's
    // duplicate check would reject the payload, and the WHOLE workout would be
    // parked. Rendered with the engine active — the case the other tests, which
    // pin it off, cannot reach at all.
    poseState = {
      analysisAvailable: true,
      poseData: { rep_count: 2, logOnly: false, corrections: [], form_correct: true },
    };
    startWorkout([exercise({ name: 'Squats', reps: 10 })]);

    // The engine's count reached the display, so it also reached the ref that
    // the capture reads (same line, by construction). Without this wait the
    // test would pass vacuously: a 0-rep set is dropped whether the gate exists
    // or not. `getAllByText` because the rep count and the set number can both
    // read "2" — the assertion is that a 2 rendered at all.
    await waitFor(() => expect(screen.getAllByText('2').length).toBeGreaterThan(0));
    expect(screen.queryByText('+1 Rep')).toBeNull(); // no manual button
    fireEvent.click(screen.getByText('Complete Set ✓'));

    await waitFor(() => expect(completeSession).toHaveBeenCalled());
    // Nothing hand-counted was filed, so with no engine summary either (the
    // hook is stubbed) there is nothing to send.
    expect(peekQueue()).toEqual([]);
  });

  it('a failure while recording a set cannot break the workout', async () => {
    // Collecting data for the new API must never be able to stop a user
    // finishing their workout. The capture sits on the set-end path, which is
    // the path that starts the rest timer and ends the session — so an
    // exception there would strand the user mid-workout. Here it throws and
    // the workout still completes and still saves the old way.
    recordThrows = true;
    startWorkout([exercise({ reps: 1 })]);
    tapRep();

    await waitFor(() => expect(completeSession).toHaveBeenCalledTimes(1));
    expect(peekQueue()).toEqual([]); // nothing recorded, nothing invented
  });
});
