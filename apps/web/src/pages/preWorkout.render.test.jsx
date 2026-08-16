// RENDER tests for the PRE-WORKOUT gate and the rep-counting choice.
//
// WHY THIS FILE EXISTS. This screen refused to start ANY workout until a live
// camera feed arrived: "Camera is working" is an AUTO checklist item, it ticks
// itself only on a stream, and the Start button is disabled until all four
// items are ticked. There is no way to tick it by hand. So no camera meant no
// workout — including a press-ups workout, which never looks at a camera for
// anything. That is the defect these tests hold shut.
//
// The other half is the choice itself (Kd's ruling, 2026-08-03): hand counting
// is something a user may PICK, not only what they get on a weak phone. What
// the choice writes into the session is what ActiveWorkout reads, so the
// assertion on the stored value is the seam between the two screens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// No camera on this machine — the whole point. `availableCams: []` is what
// getUserMedia-less environments (and a denied permission) look like here.
let cameraReady = false;
let availableCams = [];
const startCamera = vi.fn(async () => null);
const stopCamera = vi.fn();
vi.mock('../hooks/useCamera', () => ({
  default: () => ({
    videoRef: { current: null },
    error: null,
    get ready() { return cameraReady; },
    deviceLabel: '',
    get availableCams() { return availableCams; },
    startCamera,
    stopCamera,
    switchCamera: vi.fn(async () => null),
    getAvailableCameras: vi.fn(async () => availableCams),
  }),
}));

// THE OLD BACKEND, RIGGED TO FAIL — and that is the point of this fixture.
//
// Until 2026-08-16 this screen `await`ed `workoutService.createSession` against
// the old backend before it would start anything, purely to obtain a session id
// for the legacy save at the END of the workout. Both retired together. So this
// mock rejects: on the old code every test below that starts a workout would
// take the catch branch, toast "Failed to start workout" and write no session at
// all; on the new code the module is never even imported and starting costs
// nothing. A resolving mock could not tell those two worlds apart, which is why
// it does not resolve.
const createSession = vi.fn(async () => { throw new Error('the old backend is gone'); });
vi.mock('../api/workoutApi', () => ({
  workoutService: { createSession: (...a) => createSession(...a) },
}));

// Spied rather than anonymous: `triggerTransition(() => navigate(...))` is the
// last step of starting, so asserting it ran is how these tests know the screen
// got all the way to the navigation and did not bail out earlier.
const triggerTransition = vi.fn((fn) => fn());
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (...a) => triggerTransition(...a) }),
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import toast from 'react-hot-toast';
import PreWorkout from './PreWorkout';
import { getItem, setItem } from '../utils/storage';

const startButton = () => screen.getByText(/Start Workout|Complete checklist/).closest('button');

function renderScreen() {
  setItem('workout_builder', [{ id: 'e1', name: 'Push-ups', sets: 1, reps: 3, rest: 60 }]);
  return render(
    <MemoryRouter>
      <PreWorkout />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  cameraReady = false;
  availableCams = [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a workout can be started without a camera', () => {
  it('THE DEFECT: with no camera, the camera path cannot be started at all', () => {
    // The negative control for the test below, and the record of what was
    // wrong. Nothing here is being "fixed" — the camera path SHOULD still ask
    // for its checklist. The bug was that this was the only path there was.
    renderScreen();
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText(/Complete checklist/)).toBeTruthy();
  });

  it('choosing to count your own reps starts the workout with no camera at all', async () => {
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));

    expect(startButton().disabled).toBe(false);
    fireEvent.click(startButton());

    // Anchored on the WRITE, not on a network call. This used to wait for
    // `createSession`; with the legacy start retired there is no request to wait
    // for, and an anchor that no longer exists leaves the assertion below racing
    // the click — passing whether or not the screen did anything at all.
    await waitFor(() => expect(getItem('active_session', null)).not.toBeNull());
    expect(getItem('active_session', null).mode).toBe('manual');
  });

  it('does not carry a camera id into a workout that uses no camera', async () => {
    // ActiveWorkout starts the camera from this value. A stale device id on a
    // hand-counted session is a permission prompt for a camera nobody asked for.
    //
    // A CAMERA IS PRESENT for this one test, deliberately. With none, the id is
    // null whether the code clears it or not, and the assertion would hold for
    // a page that had never heard of the choice — a test that cannot fail.
    availableCams = [{ deviceId: 'cam-1', label: 'Integrated Webcam' }];
    renderScreen();
    await waitFor(() => expect(startCamera).toHaveBeenCalledWith('cam-1'));

    fireEvent.click(screen.getByText("I'll count my own reps"));
    fireEvent.click(startButton());

    await waitFor(() => expect(getItem('active_session', null)).not.toBeNull());
    expect(getItem('active_session', null).cameraDeviceId).toBeNull();
  });

  it('switches the camera OFF when the user picks hand counting', () => {
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));
    expect(stopCamera).toHaveBeenCalled();
  });

  it('drops the framing checklist, which means nothing with nothing watching', () => {
    renderScreen();
    expect(screen.getByText('Room is well lit')).toBeTruthy();
    fireEvent.click(screen.getByText("I'll count my own reps"));
    expect(screen.queryByText('Room is well lit')).toBeNull();
    expect(screen.queryByText('2m from camera')).toBeNull();
  });

  it('the choice is reversible before starting', () => {
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));
    expect(startButton().disabled).toBe(false);

    fireEvent.click(screen.getByText('Use the camera'));
    expect(screen.getByText('Room is well lit')).toBeTruthy();
    expect(startButton().disabled).toBe(true); // the camera path gates again
  });

  it('records the camera choice explicitly rather than by its absence', async () => {
    // ActiveWorkout defaults a missing mode to the camera, so this could pass by
    // writing nothing at all — which is exactly why the STORED value is what gets
    // asserted. That value is the seam between the two screens.
    //
    // The previous version of this test asserted none of that. Its name and its
    // comment both promised the stored mode was checked; the body ticked three
    // items and asserted only that the button was still disabled — and it COULD
    // not check more, because a disabled button never writes a session (T3 F6).
    // A camera that actually works is what the camera path needs, so the mock
    // hands back a stream: the fourth checklist item ticks itself on a stream,
    // and there is no way to tick it by hand.
    // A machine WITH a camera, which every other test in this file deliberately
    // lacks: the screen only reaches `startCamera` once a device is listed.
    availableCams = [{ deviceId: 'cam1', label: 'Integrated Webcam' }];
    startCamera.mockResolvedValue({ id: 'a-working-camera' });
    cameraReady = true;
    renderScreen();
    fireEvent.click(screen.getByText('Room is well lit'));
    fireEvent.click(screen.getByText('2m from camera'));
    fireEvent.click(screen.getByText('Full body visible'));

    await waitFor(() => expect(startButton().disabled).toBe(false));
    fireEvent.click(startButton());

    await waitFor(() => expect(getItem('active_session')?.mode).toBe('camera'));
  });
});

// ── Starting a workout asks NOTHING of any server (2026-08-16) ───────────────
//
// The legacy start (`createSession`) and the legacy save (`completeSession`)
// retired together — they had to, since the save's only argument was the id the
// start returned. Removing the start is what makes these two tests possible;
// every one of them is RED on the previous commit.
describe('starting a workout needs no server at all', () => {
  it('reaches the workout without asking the old backend for anything', () => {
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));
    fireEvent.click(startButton());

    // No await anywhere in this test, deliberately: starting is now synchronous,
    // and if a request crept back in the session would not exist yet here.
    expect(createSession).not.toHaveBeenCalled();
    expect(triggerTransition).toHaveBeenCalled();
    expect(getItem('active_session', null)).not.toBeNull();
  });

  it('carries no legacy session id, because there is no longer one to carry', () => {
    // The seam with ActiveWorkout. `sessionData.sessionId` was read at exactly
    // one place — the legacy save — and both ends went in the same commit. If a
    // future edit reinstates the field here, nothing consumes it and it becomes
    // a lie in storage that reads like state.
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));
    fireEvent.click(startButton());

    const stored = getItem('active_session', null);
    expect(stored).not.toBeNull();
    expect('sessionId' in stored).toBe(false);
  });

  it('THE FIX: a dead old backend can no longer stop a workout', () => {
    // The defect in its own words, from OWED.md's offline-start line: with the
    // old backend unreachable this screen said "Failed to start workout" and
    // nothing began — on a product whose Part 6 §3.6 copy promises "your workout
    // still counts". The mock at the top of this file rejects EVERY call, which
    // is that world exactly; the workout starts regardless.
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));
    // CLEARED BEFORE THE START CLICK, and that is the whole point of the line:
    // `handleModeChange` already calls `stopCamera()` when the user picks "I'll
    // count my own reps" (PreWorkout.jsx), so without this the assertion below
    // is satisfied by the PREVIOUS click and would stay green with the call
    // deleted from `handleStart` entirely — measured in T3 round 1, L-3.
    stopCamera.mockClear();
    fireEvent.click(startButton());

    expect(toast.error).not.toHaveBeenCalled();
    expect(stopCamera).toHaveBeenCalled();
    expect(triggerTransition).toHaveBeenCalled();
  });

  it('a start that CANNOT BE SAVED says so, and leaves the button usable', () => {
    // T3 round 1, C/H-1. Removing `createSession` removed the only thing in
    // this function that could REJECT, and `setItem` swallows its own errors
    // (`utils/storage.js`) — so the `catch` that used to produce this toast
    // became unreachable in the same commit, and the comment above it said the
    // opposite. A user whose storage is full then tapped Start, watched the
    // spinner, and landed back on the builder with NOTHING said, every time.
    //
    // The assertion is on the OUTCOME, not on the mechanism: the write is
    // verified to have LANDED rather than awaited for a throw, because a
    // swallowing helper cannot be caught.
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));

    // Installed AFTER renderScreen, whose own setItem must succeed.
    const quota = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    try {
      fireEvent.click(startButton());

      expect(toast.error).toHaveBeenCalledWith('Failed to start workout');
      // The workout must NOT begin: ActiveWorkout would find no session and
      // bounce the user to the builder, which is the silent failure itself.
      expect(triggerTransition).not.toHaveBeenCalled();
      expect(getItem('active_session', null)).toBeNull();
      // …and the button is live again, so a retry after freeing space works.
      // Plain DOM property, not `toBeDisabled` — jest-dom is not installed here.
      expect(startButton().disabled).toBe(false);
    } finally {
      quota.mockRestore();
    }
  });

  it('a failed start does not resurrect the PREVIOUS workout', () => {
    // The read-back check is `getItem(...) === null`, so a stale `active_session`
    // left by an earlier workout would satisfy it while the NEW write failed —
    // and ActiveWorkout would open the OLD workout, which is worse than the
    // silence this fix removes. The key is cleared BEFORE the write for exactly
    // this reason; without that line this test reads back the stale session.
    setItem('active_session', { exercises: [{ id: 'OLD', name: 'Old workout' }], name: 'Stale' });
    renderScreen();
    fireEvent.click(screen.getByText("I'll count my own reps"));

    const quota = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    try {
      fireEvent.click(startButton());

      expect(getItem('active_session', null)).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to start workout');
      expect(triggerTransition).not.toHaveBeenCalled();
    } finally {
      quota.mockRestore();
    }
  });
});
