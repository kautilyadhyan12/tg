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

const createSession = vi.fn(async () => ({ data: { session: { id: 's1' } } }));
vi.mock('../api/workoutApi', () => ({
  workoutService: { createSession: (...a) => createSession(...a) },
}));

vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (fn) => fn() }),
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

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

    await waitFor(() => expect(createSession).toHaveBeenCalled());
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

    await waitFor(() => expect(createSession).toHaveBeenCalled());
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
