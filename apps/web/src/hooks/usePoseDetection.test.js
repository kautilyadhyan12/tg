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
import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createFromOptions = vi.fn();
// Hoisted into a controllable mock (it used to be an inline `vi.fn`) because the
// bundled-assets tests below need this to FAIL for one source and succeed for
// the other — which is the whole difference between a camera that survives
// losing the network and one that does not.
const forVisionTasks = vi.fn();
vi.mock('@mediapipe/tasks-vision', () => ({
  PoseLandmarker: { createFromOptions: (...a) => createFromOptions(...a) },
  FilesetResolver: { forVisionTasks: (...a) => forVisionTasks(...a) },
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

const { default: usePoseDetection, LOCAL_WASM_BASE, REMOTE_WASM_BASE } =
  await import('./usePoseDetection.js');
const { modelUrls, POSE_DEFAULTS } = await import('../dev/poseTuning.js');
const SHIPPED_MODEL = modelUrls(POSE_DEFAULTS.model);

beforeEach(() => {
  // RESET, then re-establish the happy path. `mockClear` alone would let a
  // rejection installed by one of the fallback tests leak into every test after
  // it, and they would fail for a reason that has nothing to do with what they
  // assert.
  createFromOptions.mockReset();
  createFromOptions.mockImplementation(async () => ({ close: vi.fn(), detectForVideo: vi.fn() }));
  forVisionTasks.mockReset();
  forVisionTasks.mockImplementation(async () => ({}));
  startSet.mockClear();
  endSet.mockClear();
  framesResumed.mockClear();
});

/** The `modelAssetPath` of every landmarker the hook tried to build, in order. */
const modelPathsTried = () =>
  createFromOptions.mock.calls.map(([, opts]) => opts.baseOptions.modelAssetPath);

const render = (props) =>
  renderHook((p) => usePoseDetection(p), {
    initialProps: { exercise: 'squat', setIndex: 1, enabled: true, ...props },
  });

describe('usePoseDetection — where the camera gets its two big files', () => {
  // THE DEFECT THESE PIN. `apps/web/public/models/` never contained a `.task`
  // file, so the "local first" path could not succeed and every camera workout
  // silently downloaded the model from Google — while the WebAssembly runtime
  // came off jsdelivr unconditionally, which no owed line even mentioned. A
  // camera workout therefore required an internet connection, in an app whose
  // engine was built specifically so it would not (Part 2 I1).
  //
  // Nothing here asserts the FILES exist — that is the build script's job and
  // its own contract test's. These assert the app asks the bundle first, copes
  // when it is not there, and SAYS which happened.

  it('asks for the bundled runtime and the bundled model FIRST', async () => {
    await act(async () => { render({ analysisEnabled: true }); });
    expect(forVisionTasks).toHaveBeenNthCalledWith(1, LOCAL_WASM_BASE);
    expect(modelPathsTried()[0]).toBe(SHIPPED_MODEL.local);
  });

  it('reports that it came off the bundle, so "is this offline-capable?" is answerable', async () => {
    let out;
    await act(async () => { out = render({ analysisEnabled: true }); });
    expect(out.result.current.poseAssets.source).toBe('bundled');
  });

  it('NEVER TOUCHES THE NETWORK when the bundle works', async () => {
    // The assertion with the most teeth in this file. Everything else here
    // passes just as well on a hook that tries the bundle, ignores the result,
    // and downloads anyway — which is very close to what the old code did.
    await act(async () => { render({ analysisEnabled: true }); });
    expect(forVisionTasks).not.toHaveBeenCalledWith(REMOTE_WASM_BASE);
    expect(modelPathsTried()).not.toContain(SHIPPED_MODEL.remote);
  });

  it('falls back to the internet when the bundled MODEL is missing — the real defect', async () => {
    // Exactly what Kd's console showed: the runtime loads, then MediaPipe is
    // handed a 404 body where it expected a zip ("Unable to open zip archive",
    // MediaPipeTasksStatus=104) and both delegates fail.
    createFromOptions.mockImplementation(async (_fileset, opts) => {
      if (opts.baseOptions.modelAssetPath === SHIPPED_MODEL.local) {
        throw new Error('Unable to open zip archive. (MediaPipeTasksStatus=104)');
      }
      return { close: vi.fn(), detectForVideo: vi.fn() };
    });

    let out;
    await act(async () => { out = render({ analysisEnabled: true }); });

    expect(modelPathsTried()).toContain(SHIPPED_MODEL.remote);
    expect(out.result.current.poseAssets.source).toBe('network');
  });

  it('falls back when the bundled RUNTIME is missing, not just the model', async () => {
    // The half no owed line named. A build that shipped the model but not the
    // WebAssembly is still an online-only camera, and must be reported as one.
    forVisionTasks.mockImplementation(async (base) => {
      if (base === LOCAL_WASM_BASE) throw new Error('failed to fetch');
      return {};
    });

    let out;
    await act(async () => { out = render({ analysisEnabled: true }); });

    expect(forVisionTasks).toHaveBeenCalledWith(REMOTE_WASM_BASE);
    expect(out.result.current.poseAssets.source).toBe('network');
  });

  it('does not mix sources — a bundled runtime is never paired with a CDN model', async () => {
    // If the model is unusable, the runtime it was paired with is suspect too,
    // and a half-bundled camera is offline-capable in neither direction while
    // looking like it might be. The retry starts over from the top.
    createFromOptions.mockImplementation(async (_fileset, opts) => {
      if (opts.baseOptions.modelAssetPath === SHIPPED_MODEL.local) throw new Error('nope');
      return { close: vi.fn(), detectForVideo: vi.fn() };
    });

    await act(async () => { render({ analysisEnabled: true }); });

    // The remote model was fetched, and the remote RUNTIME was resolved for it.
    expect(modelPathsTried()).toContain(SHIPPED_MODEL.remote);
    expect(forVisionTasks).toHaveBeenCalledWith(REMOTE_WASM_BASE);
  });

  it('reports how long the camera took to become ready', async () => {
    // The card's headline claim is that the camera starts sooner. The old
    // figure (~1.4 s of wasted retries) came off a console months ago; this is
    // what lets it be re-measured rather than re-quoted.
    let out;
    await act(async () => { out = render({ analysisEnabled: true }); });
    expect(Number.isFinite(out.result.current.poseAssets.ms)).toBe(true);
    expect(out.result.current.poseAssets.ms).toBeGreaterThanOrEqual(0);
  });

  it('reports NOTHING until MediaPipe is actually ready', async () => {
    // `poseAssets` is evidence. Evidence that appears before the thing it
    // describes has happened is the "absent is not zero" trap (:6749) wearing a
    // different hat — a smoke would read "bundled" off a camera that had not
    // loaded yet.
    const seen = [];
    renderHook(
      (p) => { const r = usePoseDetection(p); seen.push(r.poseAssets); return r; },
      { initialProps: { exercise: 'squat', setIndex: 1, enabled: true, analysisEnabled: true } },
    );
    expect(seen[0]).toBe(null);
  });

  it('downloads NOTHING AT ALL, bundled or remote, for a hand-counted workout', async () => {
    await act(async () => { render({ analysisEnabled: false }); });
    expect(forVisionTasks).not.toHaveBeenCalled();
    expect(createFromOptions).not.toHaveBeenCalled();
  });
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

describe('usePoseDetection — the delivered-frames meter is actually fed', () => {
  // WHY THIS IS DRIVEN THROUGH THE REAL FRAME LOOP RATHER THAN SPIED ON.
  // `poseThroughput.test.js` proves the meter computes a rate correctly. That
  // says nothing about whether the hook ever hands it a frame — delete the one
  // `push` in the feed branch and every one of those tests stays green, which
  // is :5104 F1's shape exactly ("the gate was protected by nothing, because
  // every test injected a stub one layer below it"). So the loop is stepped by
  // hand with a controlled clock, and the assertion is on the rate that comes
  // back out through the hook's own reader.

  /** Drive `n` engine feeds `dtMs` apart and return the hook's rate. */
  async function measure({ n, dtMs }) {
    // UNMOUNT EVERY HOOK THIS FILE HAS ALREADY RENDERED, and this line is the
    // whole reason these tests were flaky rather than a nicety.
    //
    // `vitest.config.js` sets neither `globals` nor a setup file, so
    // @testing-library's automatic cleanup is NEVER REGISTERED and every
    // earlier `renderHook` in this file is still mounted with a live frame
    // loop. Those loops call `requestAnimationFrame`, which is spied below —
    // so a previous test's loop reschedules itself into THIS test's captured
    // array, and stepping pops a foreign callback that feeds a foreign meter.
    // The symptom was a bare `null` rate, moving between the two tests below
    // from run to run. Unmounting first makes each measurement the only thing
    // running.
    cleanup();

    let clock = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // Captured, never auto-run: jsdom's rAF fires on its own schedule, and the
    // frames would then arrive at wall-clock intervals rather than the ones
    // under test.
    const frames = [];
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb) => { frames.push(cb); return frames.length; });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    try {
      const video = document.createElement('video');
      Object.defineProperty(video, 'readyState', { configurable: true, get: () => 2 });

      let out;
      await act(async () => {
        out = renderHook((p) => usePoseDetection(p), {
          initialProps: { exercise: 'squat', setIndex: 1, enabled: true, analysisEnabled: true },
        });
      });

      // WAIT FOR MEDIAPIPE, DETERMINISTICALLY — and this was a real flake, not a
      // precaution. `processFrame` returns at its first guard until the async
      // init resolves, so stepping frames too early feeds the meter NOTHING and
      // `hz()` correctly answers null; one run in five failed that way while the
      // code was right. A fixed number of microtask flushes is not a wait, so
      // this polls the hook's own readiness signal instead.
      for (let i = 0; i < 50 && out.result.current.poseAssets === null; i += 1) {
        await act(async () => { await Promise.resolve(); });
      }
      expect(out.result.current.poseAssets, 'MediaPipe never became ready').not.toBe(null);

      // The mocked landmarker returns a real (if empty) result shape, or
      // `processFrame` throws on `results.landmarks` and returns before feeding.
      frames.length = 0;   // nothing captured during setup counts as a frame
      await act(async () => { out.result.current.startStreaming(video); });

      for (let i = 0; i < n; i += 1) {
        const cb = frames.pop();
        // A frame loop that stopped rescheduling would otherwise surface as a
        // bare `null` rate, sending the next reader to the meter's arithmetic
        // to look for a fault that is not there.
        expect(cb, `frame loop stopped rescheduling after ${i} frames`).toBeTypeOf('function');
        await act(async () => { cb(); });
        clock += dtMs;
      }
      return out.result.current.readPoseHz();
    } finally {
      nowSpy.mockRestore();
      rafSpy.mockRestore();
      vi.mocked(globalThis.cancelAnimationFrame).mockRestore?.();
    }
  }

  beforeEach(() => {
    createFromOptions.mockImplementation(async () => ({
      close: vi.fn(),
      detectForVideo: vi.fn(() => ({ landmarks: [] })),
    }));
  });

  it('says NULL before any frame has been delivered', async () => {
    let out;
    await act(async () => { out = render({ analysisEnabled: true }); });
    expect(out.result.current.readPoseHz()).toBe(null);
  });

  it('reads back the rate the frames actually arrived at', async () => {
    // 67 ms apart is the app's own FEED_INTERVAL_MS, so this is a machine
    // keeping up: just under 15.
    const hz = await measure({ n: 60, dtMs: 67 });
    expect(hz).not.toBe(null);
    expect(hz).toBeCloseTo(1000 / 67, 1);
  });

  it('reads back a SLOW machine as slow, which is the whole point of having it', async () => {
    // ~11 fps is where Kd's own clips landed (:6386). A meter that could not
    // tell this from the case above would be useless for the model decision it
    // exists to inform.
    const hz = await measure({ n: 60, dtMs: 90 });
    expect(hz).not.toBe(null);
    expect(hz).toBeCloseTo(1000 / 90, 1);
    expect(hz).toBeLessThan(15);
  });
});
