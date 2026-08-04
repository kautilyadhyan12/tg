// @vitest-environment jsdom
//
// Per-file, for the same reason as usePoseDetection.test.js: this renders one
// hook, not a screen, so it should not borrow the `*.render.test.jsx` name.

/** T3 F1, the half that lives outside the workout screen.
 *
 *  `error` was written in exactly ONE place — the catch inside `startCamera` —
 *  which can only fire while the camera is being OPENED. A webcam unplugged
 *  after streaming had begun therefore reported nothing at all: the stream just
 *  stopped producing frames, `error` stayed null, and the workout screen had no
 *  signal to fall back on. The smoke's step 6 ("unplug the webcam mid-set") was
 *  describing a path the code could not take.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useCamera from './useCamera.js';

/** A MediaStreamTrack stand-in that records its listeners so a test can fire
 *  them — which is what a real unplug does. */
function fakeTrack(label = 'Integrated Webcam') {
  const listeners = {};
  return {
    label,
    stop: vi.fn(),
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    fire: (name) => (listeners[name] ?? []).forEach((fn) => fn()),
    listenerCount: (name) => (listeners[name] ?? []).length,
  };
}

let track;
beforeEach(() => {
  track = fakeTrack();
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  globalThis.navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => stream),
    enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'a', label: 'cam' }]),
  };
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('useCamera — a camera that dies after it started', () => {
  it('reports an error when the video track ENDS (the webcam is unplugged)', async () => {
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      const p = result.current.startCamera();
      await vi.advanceTimersByTimeAsync(600);   // the virtual-camera settle delay
      await p;
    });
    expect(result.current.error).toBeNull();    // healthy so far — the control

    await act(async () => { track.fire('ended'); });
    expect(result.current.error).toBe('Camera disconnected');
  });

  it('reports an error when the track is MUTED (the OS or another app takes the device)', async () => {
    // A seized device stops delivering frames without ending the track, so
    // `ended` alone would leave this case silent.
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      const p = result.current.startCamera();
      await vi.advanceTimersByTimeAsync(600);
      await p;
    });

    await act(async () => { track.fire('mute'); });
    expect(result.current.error).toBe('Camera stopped sending video');
  });

  it('CLEARS the mute error when the camera resumes (round 2 F3)', async () => {
    // `mute` is temporary by definition and `error` is otherwise cleared in
    // exactly one place — inside `startCamera`, which is not called again
    // mid-workout. So without an `unmute` listener one brief interruption left a
    // red "Camera Error" panel over a working camera for the rest of the
    // workout, and every remaining set was filed unscored.
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      const p = result.current.startCamera();
      await vi.advanceTimersByTimeAsync(600);
      await p;
    });

    await act(async () => { track.fire('mute'); });
    expect(result.current.error).toBe('Camera stopped sending video');

    await act(async () => { track.fire('unmute'); });
    expect(result.current.error).toBeNull();
  });

  it('an UNMUTE does not wipe a real disconnection', async () => {
    // Only the mute message is lifted. A device that has been removed is gone,
    // and a late `unmute` must not paint over that.
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      const p = result.current.startCamera();
      await vi.advanceTimersByTimeAsync(600);
      await p;
    });

    await act(async () => { track.fire('ended'); });
    await act(async () => { track.fire('unmute'); });
    expect(result.current.error).toBe('Camera disconnected');
  });
});
