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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const startCamera = vi.fn(async () => null);
let cameraError = null;
// A SETTER, not just a getter — round 3 F3. `error` was a getter over a plain
// module `let` with no React state behind it, so a test could choose the value
// a workout STARTED with and nothing else: changing it mid-set re-rendered
// nothing, and the one behaviour round 2's F3 fix added to production (an error
// that CLEARS when the camera recovers) was unreachable from this suite. That
// is where round 3's F2 hid. `setCameraError` is wired to real state in the mock
// below and re-renders the page the way the real hook does.
let setCameraError = (v) => { cameraError = v; };
vi.mock('../hooks/useCamera', async () => {
  const { useState, useEffect } = await import('react');
  const useMockCamera = () => {
    const [err, setErr] = useState(cameraError);
    useEffect(() => {
      setCameraError = (v) => { cameraError = v; setErr(v); };
      setErr(cameraError);
      return () => { setCameraError = (v) => { cameraError = v; }; };
    }, []);
    return { videoRef: { current: null }, stream: null, error: err, startCamera, stopCamera: vi.fn() };
  };
  return { default: useMockCamera };
});

// analysisAvailable: false is the ordinary case — 55 of the 58 catalog
// exercises have no definition. It is CONFIGURABLE rather than hardcoded so the
// engine-active path can be rendered too: with it pinned false, the rule that
// decides who owns a set could be deleted without a single test noticing.
// T3 round 1, F2.
//
// `emitSummary` reproduces the REAL hook's timing, and that timing is the whole
// reason `reconcileSets` exists: the engine's summary for a set is emitted from
// the per-set effect's CLEANUP, which React runs after the render that ended
// the set — i.e. AFTER the page has already captured the user's own count. A
// mock that emitted the summary synchronously at set end would make the
// ordering hazard untestable and every "the engine wins" assertion vacuous.
//
// `analysisAvailable` may be a FUNCTION of the exercise slug — round 3 F1. One
// value for the whole workout meant no test could render a workout where the
// answer CHANGES between exercises, which is the only place round 3's F1 lived:
// press-ups (no definition) followed by squats (definition). Every test in the
// suite used a single exercise, so the whole class was invisible.
let poseState = { poseData: null, analysisAvailable: false, emitSummary: null };
let analysisEnabledSeen = null;
const availableFor = (exercise) =>
  (typeof poseState.analysisAvailable === 'function'
    ? poseState.analysisAvailable(exercise)
    : poseState.analysisAvailable);
vi.mock('../hooks/usePoseDetection', async () => {
  const { useEffect, useState } = await import('react');
  // Named `use…` so the hook rules apply to it — this IS a hook, and an
  // anonymous arrow assigned to `default` is one ESLint cannot check.
  const useMockPoseDetection = ({ exercise, setIndex, onSetComplete, analysisEnabled }) => {
    analysisEnabledSeen = analysisEnabled;
    useEffect(() => {
      if (!poseState.emitSummary || analysisEnabled === false) return undefined;
      return () => { onSetComplete(poseState.emitSummary(setIndex)); };
      // onSetComplete is intentionally out: the page passes a new callback
      // identity on some renders, and re-running this effect would emit the
      // set's summary early — the exact ordering this mock exists to model.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setIndex, analysisEnabled]);
    // THE MOUNT TIMING IS PART OF THE CONTRACT, and this mock used to get it
    // wrong. The real hook holds `analysisAvailable` in state initialised to
    // FALSE and flips it from the per-set effect — so on the very first render
    // of every camera workout the page is told "nothing is analysing", and only
    // learns otherwise one commit later. Returning the settled value
    // synchronously made that window invisible, and a defect that only exists
    // inside it (round 2 F1: set 1 of every camera workout filed as the user's
    // own count, form score discarded) passed both the suite and the mutation
    // that was written to catch exactly it. A mock standing in for the thing
    // under test proves the mock — round 1's F4, recurring.
    // Tracks WHICH EXERCISE the answer is about, exactly as the real hook does,
    // so an exercise change reopens the question instead of carrying the
    // previous answer for one render.
    const [settledFor, setSettledFor] = useState(null);
    useEffect(() => {
      if (analysisEnabled === false) return;
      setSettledFor(exercise);
    }, [analysisEnabled, exercise, setIndex]);
    const settled = settledFor === exercise;
    const available = analysisEnabled === false ? false : availableFor(exercise);
    return {
      poseData: poseState.poseData,
      keypointsData: null,
      // The user counting their own reps means nothing is analysing, whatever
      // definitions exist — the real hook starts no session at all.
      analysisAvailable: settled && available,
      // False until the hook has actually answered FOR THIS EXERCISE. The page
      // must not read "not yet known" as "no definition exists".
      analysisSettled: analysisEnabled === false ? true : settled,
      error: null,
      startStreaming: vi.fn(),
      stop: vi.fn(),
    };
  };
  return { default: useMockPoseDetection };
});

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
    recordHandCountedSet: (...args) => {
      if (recordThrows) throw new Error('recording blew up');
      return actual.recordHandCountedSet(...args);
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

function startWorkout(exercises, session = {}) {
  setItem('active_session', { sessionId: 's1', exercises, name: 'My Workout', ...session });
  return render(
    <MemoryRouter>
      <ActiveWorkout />
    </MemoryRouter>,
  );
}

/** A §2.4-shaped engine summary for one set ordinal. */
const engineSummary = (setIndex, over = {}) => ({
  exercise: 'squat',
  setIndex,
  reps: 9,
  durationMs: 30_000,
  tempoMsAvg: null,
  romStats: null,
  view: 'side',
  holdMs: null,
  calibration: null,
  avgFormScore: 88,
  repScores: [88],
  faultCounts: {},
  engineVersion: '1.0.0',
  definitionVersion: 1,
  ...over,
});

const tapRep = () => fireEvent.click(screen.getByText('+1 Rep'));

/** THE USER takes the set over. Kd RULED on 2026-08-07 that the app must NEVER
 *  switch a camera set to hand counting by itself — not on a stall, not on a
 *  camera error — because it cannot tell a dead camera from someone standing
 *  out of frame, and the conversion was permanent and silent.
 *
 *  **Every appearance of this call below marks a place the app used to decide
 *  and the user now decides.** The tests' claims are otherwise unchanged: what
 *  each one asserts about ownership, recovery and what reaches the API still
 *  holds, and still would have failed before its fix. The step that moved is
 *  WHO pressed the button, which is the whole of the ruling. */
const takeOverSet = () => fireEvent.click(screen.getByText('Count this set myself'));

/** The one workout the queue holds, or undefined. */
const queued = () => peekQueue()[0];

const realNow = Date.now.bind(Date);
let clockOffset = 0;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  recordThrows = false;
  cameraError = null;
  analysisEnabledSeen = null;
  poseState = { poseData: null, analysisAvailable: false, emitSummary: null };
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

  it('sends ONE entry for a set the engine graded — the engine\'s, not both', async () => {
    // Two entries claiming one set number fail the contract's duplicate check
    // and park the WHOLE workout. The page now records the user's count for
    // every set, so this is the assertion that keeps that from becoming a
    // double-file: the engine measured this set, so the engine's entry is the
    // one sent, complete with the form score a hand-counted set can never have.
    poseState = {
      analysisAvailable: true,
      poseData: { rep_count: 2, logOnly: false, corrections: [], form_correct: true },
      emitSummary: (setIndex) => engineSummary(setIndex),
    };
    startWorkout([exercise({ name: 'Squats', reps: 10 })]);

    await waitFor(() => expect(screen.getAllByText('2').length).toBeGreaterThan(0));
    expect(screen.queryByText('+1 Rep')).toBeNull(); // the engine is counting
    fireEvent.click(screen.getByText('Complete Set ✓'));

    await waitFor(() => expect(queued()).toBeDefined());
    const { sets } = queued();
    expect(sets).toHaveLength(1);
    expect(sets[0].setIndex).toBe(1);
    expect(sets[0].mode).toBeUndefined();      // an engine set, not log_only
    expect(sets[0].avgFormScore).toBe(88);
    expect(sets[0].reps).toBe(9);              // the engine's count, not the display's 2
  });

  it('A CAMERA THAT NEVER STARTS DOES NOT SWALLOW THE SET', async () => {
    // THE DEFECT THIS FILE PREVIOUSLY ASSERTED AS CORRECT. The old test here
    // rendered exactly this state — a definition exists, the engine files
    // nothing — and asserted the queue stayed EMPTY, describing it as "nothing
    // to send". That is a set the user performed, on a workout that syncs,
    // disappearing: history showing less training than actually happened.
    //
    // `analysisAvailable` was never a statement about the camera. It goes true
    // the moment a definition COMPILES. With the camera refused, the engine is
    // fed zero frames, files nothing, and the page used to stand aside for it.
    cameraError = 'Permission denied';
    poseState = {
      analysisAvailable: true,   // a definition exists for Squats
      poseData: null,            // ...and not one frame ever reached the engine
      emitSummary: null,         // so the engine files nothing at all
    };
    startWorkout([exercise({ name: 'Squats', reps: 3 })]);

    // The user is not stranded: the TAKEOVER is offered because nothing else is
    // counting, and it is offered at once — a camera error needs no waiting.
    // What changed on 2026-08-07 is that it is an OFFER and not a conversion.
    await waitFor(() => expect(screen.getByText('Count this set myself')).toBeTruthy());
    takeOverSet();
    tapRep();
    tapRep();
    tapRep();

    await waitFor(() => expect(queued()).toBeDefined());
    const { sets } = queued();
    expect(sets).toHaveLength(1);
    expect(sets[0].reps).toBe(3);
    expect(sets[0].exercise).toBe('squat');
    expect(sets[0].mode).toBe('log_only');   // honestly unscored, not graded
    expect(sets[0].avgFormScore).toBeNull();
  });

  it('OFFERS the takeover after a camera that reports no error and sends no frames — and does not take it', async () => {
    // The quieter half of the same failure: permission dialog left sitting
    // open, MediaPipe still downloading, or a device that claims to exist and
    // never streams. There is no error to react to — only silence — so the
    // offer is timed, and until it arrives the user has no way to record a rep.
    //
    // Only the POLL timer is faked: this file spies on Date.now for durations,
    // and a full fake clock would fight that and deadlock testing-library's
    // waits. The silence itself is expressed by moving `clockOffset`, which is
    // what the page's gap check actually reads.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = { analysisAvailable: true, poseData: null, emitSummary: null };
      startWorkout([exercise({ name: 'Squats', reps: 2 })]);

      // Not offered immediately — a slow start must not flash the button.
      expect(screen.queryByText('Count this set myself')).toBeNull();

      clockOffset = 6000;                                    // six seconds of silence
      await act(async () => { vi.advanceTimersByTime(1000); });  // one poll tick
      expect(screen.getByText('Count this set myself')).toBeTruthy();
      // KD'S RULING, ASSERTED DIRECTLY: the offer appeared and the app did NOT
      // act on it. Before 2026-08-07 the rep button was already on screen here
      // and the set had already been taken from the camera.
      expect(screen.queryByText('+1 Rep')).toBeNull();
      takeOverSet();
      expect(screen.getByText('+1 Rep')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('THE CAMERA DIES MID-SET: frames stop, no error is raised, the takeover is offered', async () => {
    // T3 F1, and the reason smoke step 6 could not pass by the route it claimed.
    // The old guard asked `poseData == null`, which is only ever true BEFORE a
    // set's first frame: null is written once, at set start, and the engine's
    // feed never returns null. So once one frame had landed the page could never
    // see silence again — unplug the webcam mid-set and the last frame just sat
    // there, no error, no button, no way to record the rest of the set.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
        emitSummary: null,
      };
      startWorkout([exercise({ name: 'Squats', reps: 5 })]);

      // The camera IS counting. No button — this is the positive control, and it
      // is what stops the fix from simply offering the button to everyone.
      await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThan(0));
      expect(screen.queryByText('+1 Rep')).toBeNull();

      // The webcam is pulled. `poseData` deliberately keeps its last value —
      // that is the real behaviour, and the state the old guard was blind to.
      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(screen.getByText('Count this set myself')).toBeTruthy();
      expect(screen.queryByText('+1 Rep')).toBeNull();  // offered, not taken
      takeOverSet();
      expect(screen.getByText('+1 Rep')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('THE FIRST SET of a camera workout keeps its form score (round 2 F1)', async () => {
    // The window nobody could see. `analysisAvailable` is state initialised to
    // false and flipped from an effect, so on render 1 of EVERY camera workout
    // the page is told nothing is analysing. The ownership effect ran in that
    // render, marked set 1 as the user's, and never cleared it — so rule 1
    // spliced the engine's summary out and set 1 was filed `log_only` with no
    // score. Sets 2..N were fine, which is why it read as correct.
    poseState = {
      analysisAvailable: true,
      poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
      emitSummary: (setIndex) => engineSummary(setIndex, { reps: 1 }),
    };
    startWorkout([exercise({ name: 'Squats', sets: 1, reps: 1 })]);

    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const [set] = queued().sets;
    expect(set.mode).toBeUndefined();          // the ENGINE's entry, not the user's
    expect(set.avgFormScore).not.toBeNull();
  });

  it('A GRADED EXERCISE AFTER AN UNGRADED ONE keeps its form score (round 3 F1)', async () => {
    // Round 2's F1 at a second trigger, and the one every test in this file was
    // structurally blind to: they all use ONE exercise. `analysisAvailable` is
    // per-exercise state written from an effect, so on the render where the
    // exercise CHANGES it still holds the previous exercise's answer. Press-ups
    // (no definition) → squats (definition): settled was already true, available
    // was still false, and the squat set was marked hand-counted before the
    // engine spoke. The screen said "AI form check" and the history disagreed.
    poseState = {
      analysisAvailable: (ex) => ex === 'squats',
      poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
      emitSummary: (setIndex) => (setIndex === 2 ? engineSummary(2, { reps: 1 }) : null),
    };
    startWorkout([
      exercise({ name: 'Push-ups', sets: 1, reps: 1 }),
      exercise({ name: 'Squats', sets: 1, reps: 1 }),
    ]);

    tapRep();                                    // push-ups: hand-counted, correct
    await waitFor(() => expect(screen.getByText('Skip Rest →')).toBeTruthy());
    fireEvent.click(screen.getByText('Skip Rest →'));

    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const sets = queued().sets;
    const squat = sets.find((s) => s.exercise === 'squat');
    expect(squat).toBeDefined();
    expect(squat.mode).toBeUndefined();          // the ENGINE's entry
    expect(squat.avgFormScore).not.toBeNull();
  });

  it('A CAMERA THAT RECOVERS does not take the set back (round 3 F2)', async () => {
    // Round 2's F3 fix made a camera error CLEARABLE, and `cameraError` was a
    // live term in `countItYourself` while ownership was write-once. So on
    // recovery the rep button vanished mid-set — the camera taking a set back,
    // which Kd's ruling forbids — and the set was filed as the user's own count
    // anyway. Mobile browsers mute the track on backgrounding, so this is the
    // same user action as the hidden-tab case arriving down the other path.
    poseState = {
      analysisAvailable: true,
      poseData: { rep_count: 0, logOnly: false, corrections: [], form_correct: true },
      emitSummary: () => engineSummary(1, { reps: 9 }),
    };
    startWorkout([exercise({ name: 'Squats', sets: 1, reps: 4 })]);

    act(() => setCameraError('Camera stopped sending video'));
    // THE USER takes it over (2026-08-07): the error offers, it no longer
    // converts. Everything this test claims begins after that press.
    await waitFor(() => expect(screen.getByText('Count this set myself')).toBeTruthy());
    takeOverSet();
    tapRep();
    tapRep();

    // The camera comes back mid-set.
    act(() => setCameraError(null));
    expect(screen.getByText('+1 Rep')).toBeTruthy();   // still the user's set

    tapRep();
    tapRep();                                          // reaches the target
    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const [set] = queued().sets;
    expect(set.reps).toBe(4);                          // what they tapped
    expect(set.mode).toBe('log_only');
  });

  it('a camera that wakes up AHEAD of the user cannot overwrite their count', async () => {
    // The teeth behind "the camera does not take a set back". The existing
    // recovery test had the engine returning a count BELOW what the user had
    // tapped, so the display guard (`reps > lastRepCountRef`) declined it on its
    // own and the ownership rule was never actually exercised — the mutant that
    // reinstates the old `manualMode` guard survived. Here the camera comes back
    // claiming MORE reps than the user counted, which is the only shape that
    // tells the two rules apart.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = { analysisAvailable: true, poseData: null, emitSummary: null };
      startWorkout([exercise({ name: 'Squats', sets: 1, reps: 20 })]);

      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });
      takeOverSet();                                  // THE USER takes it (2026-08-07)
      tapRep();
      tapRep();                                       // the user has counted 2

      await act(async () => {
        poseState.poseData = { rep_count: 9, logOnly: false, corrections: [], form_correct: true };
        clockOffset = 6100;
        vi.advanceTimersByTime(1000);
      });

      fireEvent.click(screen.getByText('Complete Set ✓'));
    } finally {
      vi.useRealTimers();
    }

    // What reaches the wire is the 2 they tapped, not the 9 the camera claimed.
    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const [set] = queued().sets;
    expect(set.reps).toBe(2);
    expect(set.mode).toBe('log_only');
  });

  it('BACKGROUNDING THE TAB does not cost the set its grading (round 4 F1)', async () => {
    // The third route to the same failure. Mobile browsers MUTE the video track
    // when the page is backgrounded, and `useCamera` turns a mute into an error —
    // so glancing at a notification raised a camera error, the sticky stamp made
    // it permanent, and the set came back hand-counted with its form score
    // discarded, on a camera that was fine before and after. Round 2's F2 added
    // the hidden guard to the stall poll for exactly this action; the error path
    // was written later and skipped it.
    const hide = (v) => {
      Object.defineProperty(document, 'hidden', { value: v, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
        emitSummary: () => engineSummary(1, { reps: 1 }),
      };
      // Target 5, NOT 1. At 1 the engine's own rep completes the set on the
      // first render and the workout is over before the test does anything —
      // which is how the first version of this test passed with the fix removed.
      startWorkout([exercise({ name: 'Squats', sets: 1, reps: 5 })]);
      await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThan(0));

      // Hidden → the track mutes → an error arrives → and it clears on return.
      await act(async () => { hide(true); setCameraError('Camera stopped sending video'); });

      // T3 ROUND 1, rule 4 — the payload assertions at the end of this test go
      // GREEN with `&& !pageHidden` deleted from `cameraDown`. Since :6008 a
      // camera error decides nothing about ownership, so the set files as the
      // engine's either way and the guard's only remaining job is the SCREEN.
      // A muted track on a backgrounded tab must not offer to hand the set over
      // and must not take the badge off "AI form check" — the camera is fine.
      expect(screen.queryByText('Count this set myself')).toBeNull();
      expect(screen.getByText('AI form check')).toBeTruthy();

      await act(async () => { setCameraError(null); hide(false); });

      // End the set by hand so the workout finishes and the payload is written.
      fireEvent.click(screen.getByText('Complete Set ✓'));

      await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
      const [set] = queued().sets;
      expect(set.mode).toBeUndefined();      // still the ENGINE's set
      expect(set.avgFormScore).not.toBeNull();
    } finally {
      hide(false);
    }
  });

  it('a redo AFTER the camera recovers gets grading back (round 4 F2)', async () => {
    // Round 2's F4 carried a live stall across a redo, justified by "the camera
    // has not come back just because the set was restarted" — but the condition
    // never checked whether it HAD. A user who redid a set once the camera was
    // working again was locked out of grading for the new set too: live preview,
    // badge still reading "Camera not counting", set filed unscored.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = { analysisAvailable: true, poseData: null, emitSummary: null };
      startWorkout([exercise({ name: 'Squats', sets: 1, reps: 9 })]);

      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });
      takeOverSet();                                        // THE USER takes it
      expect(screen.getByText('+1 Rep')).toBeTruthy();      // stalled, and taken

      // Frames resume: the camera is demonstrably alive again.
      await act(async () => {
        poseState.poseData = { rep_count: 0, logOnly: false, corrections: [], form_correct: true };
        clockOffset = 6200;
        vi.advanceTimersByTime(1000);
      });

      fireEvent.click(screen.getByTitle('Reset reps for this set'));
      await waitFor(() => expect(screen.queryByText('+1 Rep')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('A CAMERA THAT IS WORKING is never interrupted by the stall timer', async () => {
    // The positive control for the gap check — and, since T3 round 2, a real
    // one again.
    //
    // ITS COMMENT HAS NOW BEEN WRONG TWICE, AND THIS IS THE SECOND CORRECTION.
    // Round 1 found it caught neither mutation it claimed (never refreshing the
    // heartbeat; ignoring the gap) and concluded the threshold was UNOBSERVABLE:
    // a fresh frame CLEARS the stall since :6008, so the stamp and the clear
    // land in the same flush. That was true of THE LOOP BELOW AS IT WAS THEN
    // WRITTEN — every iteration delivered a new frame inside the same `act` as
    // the poll — and it was mistaken for a property of the page. It is not.
    //
    // The page polls once a second while frames land about fifteen times a
    // second, so the poll fires BETWEEN frames nearly every time, and that gap
    // is exactly where the threshold is visible. The step after the loop is
    // that gap: half a second since the last frame, nowhere near five seconds.
    // `ENGINE_STALL_MS = 0` reddens this test (measured both ways, 2026-08-07),
    // because at zero a perfectly healthy camera offers to hand every set over,
    // once a second, for the whole workout.
    //
    // The CLEARING is still real and still pinned elsewhere — deleting that line
    // reddens the KD RULING test and the badge test. The threshold is pinned
    // here.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 0, logOnly: false, corrections: [], form_correct: true },
        emitSummary: null,
      };
      startWorkout([exercise({ name: 'Squats', reps: 9 })]);

      // Six seconds pass, but a fresh frame lands every second — a healthy
      // camera. Total elapsed is well past the threshold; the GAP never is.
      for (let i = 1; i <= 6; i += 1) {
        await act(async () => {
          clockOffset = i * 1000;
          poseState.poseData = { rep_count: 0, logOnly: false, corrections: [], form_correct: true };
          vi.advanceTimersByTime(1000);
        });
      }
      // ONE POLL BETWEEN TWO FRAMES — where a real camera spends almost all of
      // its time, and the case the loop above never reached. No new frame lands
      // in this `act`, so nothing clears the stall and nothing re-stamps the
      // heartbeat: whatever the poll decides here is what the user is left
      // looking at. Half a second of gap must not be read as a dead camera.
      await act(async () => {
        clockOffset = 6500;
        vi.advanceTimersByTime(1000);
      });

      // T3 ROUND 1, rule 4 — the '+1 Rep' line below is NOT what protects this
      // test, and round 2 corrected the reason given for keeping it. Since
      // :6008 no stall can ever produce that button: only the user's own press
      // can. The stall machinery's whole remaining output is the OFFER and the
      // BADGE, so that is what a stall test has to look at. The old line stays
      // as a cheap cross-check — but it does NOT "pin the ruling", which is what
      // round 1's comment claimed: no stall ever registers in this test, so
      // there is nothing here for the ruling to be violated BY. The ruling is
      // pinned by the tests that assert WHILE A STALL IS LIVE — 'KD RULING
      // 2026-08-07' and the two round-1 badge tests.
      expect(screen.queryByText('Count this set myself')).toBeNull();
      expect(screen.getByText('AI form check')).toBeTruthy();
      expect(screen.queryByText('+1 Rep')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('SWITCHING TABS is not mistaken for a dead camera (round 2 F2)', async () => {
    // The frame loop stops itself while the page is hidden and the browser
    // pauses rAF anyway — but the stall poll reads the wall clock, which does
    // not care. Six seconds in another app therefore looked exactly like an
    // unplugged webcam, and because the handover is sticky by ruling, the user
    // came back to a live camera preview, a "Camera not counting" badge that
    // never cleared, and that set filed with no form score.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    const hide = (v) => {
      Object.defineProperty(document, 'hidden', { value: v, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 0, logOnly: false, corrections: [], form_correct: true },
        emitSummary: null,
      };
      startWorkout([exercise({ name: 'Squats', reps: 9 })]);
      await waitFor(() => expect(screen.queryByText('+1 Rep')).toBeNull());

      await act(async () => { hide(true); clockOffset = 6000; vi.advanceTimersByTime(6000); });
      await act(async () => { hide(false); vi.advanceTimersByTime(1000); });

      // T3 ROUND 1, rule 4 — same story as the working-camera control above:
      // deleting `if (document.hidden) return` from the poll left the '+1 Rep'
      // line GREEN, because a stall no longer reaches that button. What coming
      // back from another app must not show is the OFFER, and a badge that has
      // given up on a camera which never stopped working.
      expect(screen.queryByText('Count this set myself')).toBeNull();
      expect(screen.getByText('AI form check')).toBeTruthy();
      expect(screen.queryByText('+1 Rep')).toBeNull();
    } finally {
      hide(false);
      vi.useRealTimers();
    }
  });

  it('a redo during a stall keeps the rep button (round 2 F4)', async () => {
    // Re-keying the set cleared `stalledSetKey`, so the user who pressed redo
    // BECAUSE the camera had stopped counting lost the button for another five
    // seconds — with the camera still dead. The camera has not recovered just
    // because the set was restarted.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = { analysisAvailable: true, poseData: null, emitSummary: null };
      startWorkout([exercise({ name: 'Squats', reps: 9 })]);

      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });
      takeOverSet();                                    // THE USER takes it
      expect(screen.getByText('+1 Rep')).toBeTruthy();

      fireEvent.click(screen.getByTitle('Reset reps for this set'));
      // The CHOICE carries too, not just the stall — otherwise redo would hand
      // the user back to a still-dead camera and make them choose again.
      expect(screen.getByText('+1 Rep')).toBeTruthy();   // still there, same instant
    } finally {
      vi.useRealTimers();
    }
  });

  it('KD RULING 2026-08-07: a stalled camera NEVER takes the set — and stepping back into frame resumes counting', async () => {
    // THE DEFECT THIS REPLACES, in Kd's words: "if someone chooses camera why
    // the fuck in mid set reverses to hand". Five seconds of unusable frames
    // looked identical whether the camera had DIED or the user had simply
    // stepped out of shot, and either way the set was converted permanently and
    // its form score silently discarded.
    //
    // This is the positive control for the ruling: the app offers and waits.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
        emitSummary: () => engineSummary(1, { reps: 4 }),
      };
      startWorkout([exercise({ name: 'Squats', sets: 1, reps: 4 })]);
      await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThan(0));

      // The user steps out of frame: frames stop being usable for six seconds.
      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });

      // THE SET IS STILL THE CAMERA'S. The offer is there; nothing was taken.
      expect(screen.getByText('Count this set myself')).toBeTruthy();
      expect(screen.queryByText('+1 Rep')).toBeNull();

      // They step BACK into frame. Counting simply carries on — there is no
      // ownership to win back, because none was ever surrendered.
      await act(async () => {
        poseState.poseData = { rep_count: 2, logOnly: false, corrections: [], form_correct: true };
        clockOffset = 6100;
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText('+1 Rep')).toBeNull();
      expect(screen.queryByText('Count this set myself')).toBeNull();

      fireEvent.click(screen.getByText('Complete Set ✓'));
    } finally {
      vi.useRealTimers();
    }

    // And it reaches the wire as the ENGINE's graded set, not as a hand count.
    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const [set] = queued().sets;
    expect(set.mode).toBeUndefined();        // the engine's entry
    expect(set.avgFormScore).not.toBeNull(); // the grade survived the stall
  });

  it('T3 ROUND 1 C/H-1: a STALLED camera never wears the green "AI form check" badge', async () => {
    // THE DEFECT: the ruling took `engineStalled || cameraDown` out of
    // `countItYourself` — correctly — but the badge was derived as
    // `!countItYourself`, so it stayed GREEN, eye icon, "AI form check",
    // directly above its own panel saying the camera had stopped. It told the
    // user it was grading a set it was not grading, and the set filed with no form
    // score. Nothing in the suite looked at this badge at all, which is why it
    // shipped.
    //
    // It also stranded the 'Camera not counting' wording, which the ruling had
    // explicitly KEPT: that arm needs the badge to be un-green, which the old
    // expression made impossible.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
        emitSummary: null,
      };
      startWorkout([exercise({ name: 'Squats', sets: 1, reps: 9 })]);
      await waitFor(() => expect(screen.getByText('AI form check')).toBeTruthy());

      // Frames stop for six seconds.
      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });

      expect(screen.queryByText('AI form check')).toBeNull();
      expect(screen.getByText('Camera not counting')).toBeTruthy();
      // And the ruling still holds underneath it: the SET was not taken away.
      expect(screen.getByText('Count this set myself')).toBeTruthy();
      expect(screen.queryByText('+1 Rep')).toBeNull();

      // Step back into frame: the badge goes green again by itself.
      await act(async () => {
        poseState.poseData = { rep_count: 2, logOnly: false, corrections: [], form_correct: true };
        clockOffset = 6100;
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('AI form check')).toBeTruthy();
      expect(screen.queryByText('Camera not counting')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('T3 ROUND 1 C/H-1: a camera ERROR never wears the green "AI form check" badge either', async () => {
    // The second route into the same false badge. `cameraDown` is the other
    // term the ruling left driving the badge, and it was equally unread.
    poseState = {
      analysisAvailable: true,
      poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
      emitSummary: null,
    };
    startWorkout([exercise({ name: 'Squats', sets: 1, reps: 9 })]);
    await waitFor(() => expect(screen.getByText('AI form check')).toBeTruthy());

    await act(async () => { setCameraError('Camera stopped sending video'); });

    expect(screen.queryByText('AI form check')).toBeNull();
    expect(screen.getByText('Camera not counting')).toBeTruthy();
    expect(screen.queryByText('+1 Rep')).toBeNull();
  });

  it('T3 ROUND 1 C/H-2: the stall cue does not name a cause the app cannot know', async () => {
    // THE DEFECT: "The camera can't see you well enough to count. Step back
    // into frame and it carries on." — asserted as the diagnosis on a path
    // reached by ANY absence of frames. :6008 exists precisely because the app
    // cannot tell a user out of shot from a camera that has died, so on a hung
    // model or a device that never streams this named the wrong cause and made
    // a promise it never kept: the user steps back and forth while nothing
    // loads. The out-of-shot case is now offered as a possibility, not asserted.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
        emitSummary: null,
      };
      startWorkout([exercise({ name: 'Squats', sets: 1, reps: 9 })]);
      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });

      expect(
        screen.getByText("The camera isn't counting right now. If you're out of shot, step back in — or count this set yourself."),
      ).toBeTruthy();
      expect(screen.queryByText(/can't see you well enough/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a PAUSED workout is not mistaken for a dead camera', async () => {
    // Frames legitimately stop while paused — the hook stops feeding the engine.
    // Without the pause guard the wait keeps running, and because the handover is
    // sticky the button would still be there after resuming: the user pauses to
    // take a breath and comes back to a screen that has given up on their camera.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: { rep_count: 0, logOnly: false, corrections: [], form_correct: true },
        emitSummary: null,
      };
      startWorkout([exercise({ name: 'Squats', reps: 9 })]);

      fireEvent.click(screen.getByText('Pause'));
      await act(async () => { clockOffset = 30000; vi.advanceTimersByTime(5000); });
      fireEvent.click(screen.getByText('Resume'));

      await act(async () => { vi.advanceTimersByTime(1000); });
      // T3 ROUND 1, rule 4 — removing the pause guard from the stall poll left
      // the '+1 Rep' line GREEN for the same reason as the two above. Someone
      // who paused to take a breath must come back to a screen that still says
      // the camera is watching, with no offer to abandon it.
      expect(screen.queryByText('Count this set myself')).toBeNull();
      expect(screen.getByText('AI form check')).toBeTruthy();
      expect(screen.queryByText('+1 Rep')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("THE F2 END TO END: a stalled set the user tapped out reaches the API as THEIR count", async () => {
    // The whole finding in one path. Camera slow → handover at five seconds →
    // the user taps 3 → the camera wakes and files a summary for the SAME set →
    // what reaches the wire must be the 3 they watched, log_only, no form score.
    // Before the fix this stored the engine's 2 and a grade nobody earned.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: null,
        emitSummary: () => engineSummary(1, { reps: 2 }),
      };
      startWorkout([exercise({ name: 'Squats', reps: 3 })]);

      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });
      takeOverSet();                  // THE USER takes it (2026-08-07)
      tapRep();
      tapRep();
      tapRep();                       // hits the target → set ends → workout ends
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(queued()).toBeDefined(), { timeout: 3000 });
    const sets = queued().sets;
    expect(sets).toHaveLength(1);     // never both entries for one ordinal
    expect(sets[0].reps).toBe(3);
    expect(sets[0].mode).toBe('log_only');
    expect(sets[0].avgFormScore).toBeNull();
  });

  it('a set handed to the user STAYS theirs when the camera comes back mid-set', async () => {
    // Kd's ruling 2026-08-03: the camera does not take a set back mid-set. Both
    // halves are asserted — the button must not vanish under the user's thumb,
    // and the count that reaches the wire must be the one they watched.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] });
    try {
      poseState = {
        analysisAvailable: true,
        poseData: null,
        // The camera wakes up late and files a summary for the SAME set.
        emitSummary: () => engineSummary(1),
      };
      startWorkout([exercise({ name: 'Squats', reps: 9 })]);

      clockOffset = 6000;
      await act(async () => { vi.advanceTimersByTime(1000); });
      takeOverSet();                  // THE USER takes it (2026-08-07)
      fireEvent.click(screen.getByText('+1 Rep'));
      fireEvent.click(screen.getByText('+1 Rep'));

      // The camera starts delivering again, part-way through the set.
      await act(async () => {
        poseState.poseData = { rep_count: 1, logOnly: false, corrections: [], form_correct: true };
        clockOffset = 6100;
        vi.advanceTimersByTime(1000);
      });

      // Still the user's set: the button is still there and their count stands.
      expect(screen.getByText('+1 Rep')).toBeTruthy();
      fireEvent.click(screen.getByText('+1 Rep'));
      expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mixes a graded set and a hand-counted set in one workout, one entry each', async () => {
    // The shape that turned F-3 from invisible into damaging: before the write
    // path, a squat-only workout simply synced nothing and the legacy save held
    // it whole. Once hand-logged exercises sync, a mixed workout could go up
    // with the squat sets missing — a real day, quietly short.
    poseState = {
      analysisAvailable: true,
      poseData: { rep_count: 1, logOnly: false, corrections: [], form_correct: true },
      // The engine grades set 1 and then goes dark — the camera is knocked, the
      // tab is backgrounded mid-workout. Set 2 is the user's own count.
      emitSummary: (setIndex) => (setIndex === 1 ? engineSummary(1) : null),
    };
    startWorkout([exercise({ name: 'Squats', sets: 2, reps: 1 })]);

    await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Complete Set ✓'));   // set 1, graded

    await waitFor(() => expect(screen.getByText('Skip Rest →')).toBeTruthy());
    // The camera is knocked out between sets. `poseData` is NOT reset to null
    // here any more: nothing in the real system ever puts it back to null
    // mid-workout, so a test that did was proving reconcileSets under a state
    // the app cannot produce (T3 F3). The error alone is the producible signal —
    // and it is producible only since the track-ended listener was added, which
    // is the other half of the same fix.
    act(() => setCameraError('Camera disconnected'));
    fireEvent.click(screen.getByText('Skip Rest →'));

    // THE USER takes set 2 over (2026-08-07). The camera being disconnected
    // now OFFERS this rather than performing it — which is exactly the point
    // of Kd's ruling, and this test still proves the mixed workout survives.
    await waitFor(() => expect(screen.getByText('Count this set myself')).toBeTruthy());
    takeOverSet();
    tapRep();                            // set 2, counted by hand

    await waitFor(() => expect(queued()).toBeDefined());
    const { sets } = queued();
    expect(sets.map((s) => s.setIndex)).toEqual([1, 2]);
    expect(sets[0].avgFormScore).toBe(88);      // graded
    expect(sets[1].mode).toBe('log_only');      // hand-counted
    expect(sets[1].reps).toBe(1);
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

// ── The user's CHOICE to count their own reps (Kd ruling, 2026-08-03) ────────
describe('counting your own reps is a choice, not only a fallback', () => {
  it('counts by hand on an exercise the engine COULD have graded', async () => {
    // The point of the ruling. Squats have a definition and the engine would
    // normally own them; the user said they would rather count. So: no engine
    // session, the button is there, and the set is filed as honestly unscored.
    //
    // The pose stream below is ADVERSARIAL and deliberately so — a live
    // rep_count of 7 and a summary generator, i.e. an engine behaving as if the
    // user had never chosen. The page must ignore all of it on its own account
    // rather than by trusting the hook to have switched itself off. It did not,
    // when this test was first written: the rep effect read the stream, hit the
    // target instantly and ended sets the user had not finished.
    poseState = {
      analysisAvailable: true,               // a definition exists...
      poseData: { rep_count: 7, logOnly: false, corrections: [], form_correct: true },
      emitSummary: (setIndex) => engineSummary(setIndex),  // ...and would file
    };
    startWorkout([exercise({ name: 'Squats', reps: 2 })], { mode: 'manual' });

    expect(analysisEnabledSeen).toBe(false); // the engine was never switched on
    tapRep();
    tapRep();

    await waitFor(() => expect(queued()).toBeDefined());
    const { sets } = queued();
    expect(sets).toHaveLength(1);
    expect(sets[0].reps).toBe(2);            // the user's 2, not the engine's 7 or 9
    expect(sets[0].mode).toBe('log_only');
    expect(sets[0].avgFormScore).toBeNull();
  });

  it('never asks for the camera when the user said they did not want one', async () => {
    startWorkout([exercise({ reps: 1 })], { mode: 'manual', cameraDeviceId: 'cam-1' });
    tapRep();
    await waitFor(() => expect(completeSession).toHaveBeenCalled());
    expect(startCamera).not.toHaveBeenCalled();
  });

  it('still uses the camera when that is what was chosen', async () => {
    // The negative control. Without it, "never asks for the camera" would pass
    // just as well if the page had stopped asking altogether.
    startWorkout([exercise({ name: 'Squats', reps: 1 })], { mode: 'camera' });
    await waitFor(() => expect(startCamera).toHaveBeenCalled());
    expect(analysisEnabledSeen).toBe(true);
  });

  it('treats a session saved before the choice existed as a camera workout', async () => {
    // Backward compatibility with an `active_session` already in localStorage:
    // no `mode` key means the camera, which is what every workout did before.
    startWorkout([exercise({ name: 'Squats', reps: 1 })]);
    await waitFor(() => expect(startCamera).toHaveBeenCalled());
    expect(analysisEnabledSeen).toBe(true);
  });
});
