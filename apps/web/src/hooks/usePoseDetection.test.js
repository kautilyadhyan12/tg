// @vitest-environment jsdom
//
// Declared per-file rather than by renaming to `*.render.test.jsx`: the config's
// glob means "this file renders a SCREEN and reads what a user would see", and
// this file does not — it renders one hook to watch which collaborators it
// calls. Borrowing the name to inherit the environment would blur a distinction
// the config's own comment is careful about.

/** Direct tests for the hook — T3 F4.
 *
 *  WHY THIS FILE EXISTS. Every other suite that touches pose detection REPLACES
 *  this hook with a mock, and that mock re-implements the very contract under
 *  test (`analysisAvailable: analysisEnabled === false ? false : …`). So the
 *  hook's four real guards — no model download, no engine session, no stale
 *  `analysisAvailable` — could all be deleted with 331 tests still green. A mock
 *  standing in for the thing under test proves the mock.
 *
 *  The two collaborators are stubbed at the module boundary, which is the point:
 *  the assertions are about whether the hook CALLS them, not about what they do.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createFromOptions = vi.fn(async () => ({ close: vi.fn(), detectForVideo: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  PoseLandmarker: { createFromOptions: (...a) => createFromOptions(...a) },
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
}));

const startSet = vi.fn();
const endSet = vi.fn(() => null);
const framesResumed = vi.fn();
vi.mock('../engine/sessionController.js', () => ({
  SessionController: class {
    constructor() { this.analysisAvailable = true; }
    startSet(...a) { startSet(...a); }
    endSet() { return endSet(); }
    feed() { return { rep_count: 0 }; }
    framesResumed() { framesResumed(); }
  },
}));

const { default: usePoseDetection } = await import('./usePoseDetection.js');

beforeEach(() => {
  createFromOptions.mockClear();
  startSet.mockClear();
  endSet.mockClear();
  framesResumed.mockClear();
});

const render = (props) =>
  renderHook((p) => usePoseDetection(p), {
    initialProps: { exercise: 'squat', setIndex: 1, enabled: true, ...props },
  });

describe('usePoseDetection — the user counting their own reps', () => {
  it('downloads NO pose model when analysis is switched off', async () => {
    await act(async () => { render({ analysisEnabled: false }); });
    expect(createFromOptions).not.toHaveBeenCalled();
  });

  it('starts NO engine session when analysis is switched off', async () => {
    await act(async () => { render({ analysisEnabled: false }); });
    expect(startSet).not.toHaveBeenCalled();
  });

  it('reports analysisAvailable FALSE once analysis is switched off — no stale true', async () => {
    // WRITTEN THIS WAY BECAUSE THE OBVIOUS VERSION CANNOT FAIL. Rendering
    // straight into `analysisEnabled: false` leaves the internal state at its
    // initial `false`, so deleting the guard in the return still yields false
    // and the mutant survived. The state has to be TRUE first for the guard to
    // have anything to override — which is also the only way the bug reaches a
    // user: a workout is under way, then analysis goes off, and the page is left
    // believing something is still counting when nothing is.
    let out;
    await act(async () => { out = render({ analysisEnabled: true }); });
    expect(out.result.current.analysisAvailable).toBe(true);   // genuinely true now

    await act(async () => {
      out.rerender({ exercise: 'squat', setIndex: 1, enabled: true, analysisEnabled: false });
    });
    expect(out.result.current.analysisAvailable).toBe(false);
  });

  it('POSITIVE CONTROL: with analysis on, the model loads and a session starts', async () => {
    // Without this, all three assertions above are satisfied by a hook that
    // never does anything at all.
    let out;
    await act(async () => { out = render({ analysisEnabled: true }); });
    expect(createFromOptions).toHaveBeenCalled();
    expect(startSet).toHaveBeenCalledWith('squat', 1);
    expect(out.result.current.analysisAvailable).toBe(true);
  });

  it('reports NOT SETTLED until it has actually answered — round 2 F1', async () => {
    // The distinction the page depends on. `analysisAvailable: false` means two
    // completely different things one commit apart: "I have not looked yet" on
    // the first render of every camera workout, and "I looked, there is no
    // definition" afterwards. The page treated the first as the second, and set
    // 1 of every camera workout lost its form score.
    //
    // BOTH HALVES ARE ASSERTED. The first version of this test checked only that
    // it ends up settled — the half that was never in doubt — while its name
    // promised the other one (round 3 F5). The first render's value is captured
    // by recording every render, because by the time `act` returns the effect
    // has already run and the evidence is gone.
    const seen = [];
    renderHook(
      (p) => { const r = usePoseDetection(p); seen.push(r.analysisSettled); return r; },
      { initialProps: { exercise: 'squat', setIndex: 1, enabled: true, analysisEnabled: true } },
    );
    expect(seen[0]).toBe(false);                       // "I have not looked yet"
    expect(seen[seen.length - 1]).toBe(true);          // and then it has
  });

  it('UNSETTLES when the exercise changes — round 3 F1', async () => {
    // `analysisAvailable` is per-exercise state written from the same effect, so
    // on the render where the exercise changes it still holds the PREVIOUS
    // exercise's answer. A settled flag that only means "has ever answered"
    // waves that stale value through — which is how a graded exercise following
    // an ungraded one lost its form score.
    const seen = [];
    const { rerender } = renderHook(
      (p) => { const r = usePoseDetection(p); seen.push(r.analysisSettled); return r; },
      { initialProps: { exercise: 'push_up', setIndex: 1, enabled: true, analysisEnabled: true } },
    );
    await act(async () => {});
    expect(seen[seen.length - 1]).toBe(true);

    seen.length = 0;
    rerender({ exercise: 'squat', setIndex: 2, enabled: true, analysisEnabled: true });
    expect(seen[0]).toBe(false);                       // the question is reopened
  });

  it('is settled IMMEDIATELY when the user chose to count themselves', async () => {
    // Nothing to wait for: that answer came from the user, not the engine. If it
    // reported "not settled" here, the page would withhold the rep button from
    // someone who asked for it.
    let out;
    await act(async () => { out = render({ analysisEnabled: false }); });
    expect(out.result.current.analysisSettled).toBe(true);
    expect(out.result.current.analysisAvailable).toBe(false);
  });

  it('forgets the scene when a paused set RESUMES — and only then', async () => {
    // `enabled` false is a pause or a rest: the frame feed stops, the SET does
    // not end, and frames start again from a scene that may have changed
    // completely. Without this the person check's rolling window carries
    // readings from before the break, and a message raised before it is still on
    // screen explaining a moment that is over.
    //
    // THE "AND ONLY THEN" HALF IS THE ONE THAT CAN FAIL QUIETLY. A reset on
    // every render of the effect — or on the pause rather than the resume —
    // would wipe the window while frames are still arriving, and the check would
    // spend its first second of every re-render unable to block anything.
    const props = { exercise: 'squat', setIndex: 1, enabled: true, analysisEnabled: true };
    let out;
    await act(async () => { out = render(props); });
    expect(framesResumed).not.toHaveBeenCalled();          // starting a set is not a resume

    await act(async () => { out.rerender({ ...props, enabled: false }); });
    expect(framesResumed).not.toHaveBeenCalled();          // pausing is not a resume either

    await act(async () => { out.rerender({ ...props, enabled: true }); });
    expect(framesResumed).toHaveBeenCalledTimes(1);

    await act(async () => { out.rerender({ ...props, enabled: true }); });
    expect(framesResumed).toHaveBeenCalledTimes(1);        // still enabled: nothing to forget
  });

  it('forgets the scene when the TAB comes back too — the other way a set pauses', async () => {
    // A hidden tab stops the frame loop without anything setting `enabled` to
    // false, so the resume above never fires. The set can sit there for minutes
    // and come back to a completely different room, with the person check still
    // holding the readings from before and a "not counting" sentence still on
    // screen explaining a moment nobody remembers. Same rule, second doorway —
    // the one the card wrote the rule for and did not wire.
    const props = { exercise: 'squat', setIndex: 1, enabled: true, analysisEnabled: true };
    let out;
    await act(async () => { out = render(props); });
    // A video element must exist, or the visibility handler has nothing to
    // resume and the test would pass on the wrong branch.
    await act(async () => { out.result.current.startStreaming(document.createElement('video')); });
    expect(framesResumed).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(framesResumed).not.toHaveBeenCalled();          // going away is not coming back

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(framesResumed).toHaveBeenCalledTimes(1);
  });

  it('emits the finished set summary when the set ordinal changes', async () => {
    endSet.mockReturnValue({ setIndex: 1, reps: 3 });
    const onSetComplete = vi.fn();
    let out;
    await act(async () => { out = render({ analysisEnabled: true, onSetComplete }); });
    await act(async () => { out.rerender({ exercise: 'squat', setIndex: 2, enabled: true, analysisEnabled: true, onSetComplete }); });
    expect(onSetComplete).toHaveBeenCalledWith({ setIndex: 1, reps: 3 });
  });
});
