import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseTrace } from "@app/engine";
import { PersonGate } from "@app/engine/scene";
import { goldenSquat, shakenSquat, toLandmarks } from "./__fixtures__/sceneClips.js";
import { getDefinition, startSet as adapterStartSet } from "./poseAdapter.js";
import { PERSON_GATE } from "./sceneGate.js";
import { SessionController } from "./sessionController.js";

function replay(controller, trace) {
  const displays = [];
  for (const frame of trace.frames) {
    const landmarks = frame.kp.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
    displays.push(controller.feed(landmarks, frame.t, landmarks.length > 0));
  }
  return displays;
}

describe("SessionController — engine mode (def exists)", () => {
  it("replays a golden to the expected per-set reps + SetSummary", () => {
    const trace = parseTrace(
      readFileSync(join(import.meta.dirname, "__fixtures__/squat_goodform.jsonl"), "utf8"),
    );
    const c = new SessionController();
    c.startSet(trace.header.exercise, 1);
    expect(c.analysisAvailable).toBe(true);

    const displays = replay(c, trace);
    const summary = c.endSet();

    expect(summary.reps).toBe(trace.header.expected.reps); // 2
    expect(c.repScores).toHaveLength(trace.header.expected.reps);
    // The live display carries the engine rep count and the latest rep score.
    const last = displays[displays.length - 1];
    expect(last.rep_count).toBe(summary.reps);
    expect(last.logOnly).toBeUndefined();
    expect(last.form_score).toBe(c.repScores[c.repScores.length - 1]);
  });
});

describe("SessionController — occluded legs (sitting-at-desk bug)", () => {
  // 33 valid keypoints, but every leg joint (hips/knees/ankles/feet, 23–32)
  // has near-zero visibility — MediaPipe's output when only a face is in frame.
  const legsHiddenLandmarks = () =>
    Array.from({ length: 33 }, (_, i) => ({
      x: 0.5,
      y: 0.3,
      z: 0,
      visibility: i >= 23 ? 0.01 : 1.0,
    }));

  it("shows the step-back cue and withdraws the form verdict instead of 'Good Form'", () => {
    const c = new SessionController();
    c.startSet("squat", 1);
    let d;
    for (let i = 0; i < 5; i++) d = c.feed(legsHiddenLandmarks(), i * 67, true);
    expect(d.form_correct).toBeNull(); // no verdict — nothing is measured
    expect(d.corrections[0]).toMatch(/step back/i);
    expect(d.rep_count).toBe(0); // and nothing ever counts
    // A set that never measured anything reports no score.
    expect(c.endSet().avgFormScore).toBeNull();
  });
});

describe("SessionController — no phantom summaries (T3 P1.10b-2a)", () => {
  it("endSet returns null when the set was never fed a frame", () => {
    const c = new SessionController();
    c.startSet("squat", 1); // engine session, but no feed() — e.g. StrictMode remount / setup-screen switch
    expect(c.analysisAvailable).toBe(true);
    expect(c.endSet()).toBeNull(); // no reps:0 junk reaches onSetComplete
  });
});

describe("SessionController — the person check (card 4 step 3)", () => {
  /** Feed a clip of trace rows through the bridge and keep every display. */
  function bridge(frames) {
    const c = new SessionController();
    c.startSet("squat", 1);
    const displays = frames.map((f) => c.feed(toLandmarks(f.kp), f.t, true));
    return { controller: c, displays, summary: c.endSet() };
  }

  /** The same clip straight into the engine, with no check in front of it. */
  function ungated(frames) {
    const s = adapterStartSet(getDefinition("squat"), 1);
    for (const f of frames) s.feed(toLandmarks(f.kp), f.t);
    return s.end();
  }

  const SCENE_CUE = /isn't sure it's looking at you/;
  const ENGINE_CUE = /step back/i;

  it("withholds the reps the engine would otherwise have counted", () => {
    // THE COUNTERFACTUAL, and the only proof of the blanking that does not need
    // a way to switch the check off: ONE clip, fed twice. Without the check the
    // engine counts its two reps at this shake amount — the squat is still a
    // squat. With it, the engine is handed frames carrying NO landmarks and
    // counts nothing. Delete the blanking and the second number becomes 2.
    const frames = shakenSquat(0.05);
    expect(ungated(frames).reps).toBe(2);
    expect(bridge(frames).summary.reps).toBe(0);
  });

  it("says on screen that it is not counting", () => {
    // The silence is 4.5% of a squatting person's frames, in runs of up to
    // ~1.5 s (:7054). A count that sits still with no explanation is the app
    // telling the user something false by omission (:5807).
    const { displays } = bridge(shakenSquat(0.05));
    expect(displays.filter((d) => SCENE_CUE.test(d.corrections[0] ?? "")).length).toBeGreaterThan(
      50,
    );
  });

  it("never borrows the engine's 'step back', which would name a cause it cannot know", () => {
    // The engine, fed the blank frames, flips to "cannot see your legs clearly"
    // after three of them — at a user standing in full view. That is a cue
    // naming a cause the app cannot know (:6150 C/H-2). One message replaces
    // the other; they never appear together.
    const { displays } = bridge(shakenSquat(0.05));
    expect(displays.some((d) => ENGINE_CUE.test(d.corrections[0] ?? ""))).toBe(false);
  });

  it("gives no form verdict on ANY frame it blanked, message or no message", () => {
    // The oracle is a bare gate on the SAME ruled configuration, run over the
    // same clip: it says which frames the bridge blanked, and every one of them
    // must come back without a verdict. This covers the short blocks the message
    // never speaks for — where the engine has not yet raised its own cue, so the
    // verdict comes back TRUE and "✓ Good Form" flashes over a frame the app
    // refused to look at.
    //
    // It is not circular: a mutated cut-off moves both sides together and this
    // test stays green (others catch that). What it pins is the WIRING — that
    // blocking and withholding the verdict are the same set of frames.
    const frames = shakenSquat(0.05);
    const oracle = new PersonGate({
      rules: [{ signal: PERSON_GATE.signal, cutoff: PERSON_GATE.cutoff }],
      window: PERSON_GATE.window,
    });
    const blocked = frames.map((f) => oracle.push(f).blocked);
    expect(blocked.filter(Boolean).length).toBeGreaterThan(50);

    const { displays } = bridge(frames);
    displays.forEach((d, i) => {
      if (blocked[i]) expect(d.form_correct).toBeNull();
    });
    // THE CONTROL: the frames it let through are still graded normally. Without
    // this, blanking the verdict on every frame would pass.
    expect(displays.filter((d, i) => !blocked[i] && d.form_correct !== null).length).toBeGreaterThan(
      0,
    );
  });

  it("gives no form verdict while it is saying it cannot count", () => {
    // Otherwise the screen grades a frame it refused to look at. Left to the
    // engine the verdict on those frames is FALSE (the blank frames raise its
    // own visibility cue), so "✗ Fix Form" would sit over a user whose form
    // nothing measured — and on the first two blanks of any run, before that
    // cue arrives, it is TRUE.
    const { displays } = bridge(shakenSquat(0.05));
    const speaking = displays.filter((d) => SCENE_CUE.test(d.corrections[0] ?? ""));
    expect(speaking.length).toBeGreaterThan(50);
    expect(speaking.every((d) => d.form_correct === null)).toBe(true);
  });

  it("leaves an ordinary noisy recording alone", () => {
    // THE CONTROL. A check that blocked everything would pass every assertion
    // above. Real tracking noise is far below this shake amount, and even here
    // nothing is blocked, nothing is said, and both reps are counted. The
    // engine's own coaching cues still come through untouched — the check
    // replaces them only where it is the reason for the silence.
    const { displays, summary } = bridge(shakenSquat(0.03));
    expect(summary.reps).toBe(2);
    expect(displays.some((d) => SCENE_CUE.test(d.corrections[0] ?? ""))).toBe(false);
    expect(displays.some((d) => d.form_correct === true)).toBe(true);
  });

  it("counts the untouched golden exactly as it did before the check existed", () => {
    // The second control, on the recording this package has always used.
    const trace = goldenSquat();
    expect(bridge(trace.frames).summary.reps).toBe(trace.header.expected.reps);
  });

  it("clears the message when a paused set resumes", () => {
    // Frames stop arriving during a pause or a rest, so the frame before the
    // break is not the frame before now — and a message raised before it would
    // be explaining a moment the user can no longer see.
    const c = new SessionController();
    c.startSet("squat", 1);
    let d;
    for (const f of shakenSquat(0.05).slice(0, 40)) d = c.feed(toLandmarks(f.kp), f.t, true);
    expect(SCENE_CUE.test(d.corrections[0] ?? "")).toBe(true);

    c.resetScene();
    // A frame of the real recording, a long way later in wall time — which is
    // what coming back from a pause looks like.
    d = c.feed(toLandmarks(goldenSquat().frames[0].kp), 100000, true);
    expect(SCENE_CUE.test(d.corrections[0] ?? "")).toBe(false);
    expect(d.form_correct).not.toBeNull();
  });

  it("does not run at all in log-only mode", () => {
    // Nothing to protect: the user is counting, so there are no reps to invent
    // and none to take away. resetScene must not throw where there is no check.
    const c = new SessionController();
    c.startSet("bench_press", 1);
    expect(() => c.resetScene()).not.toThrow();
    const d = c.feed(toLandmarks(shakenSquat(0.05)[0].kp), 0, true);
    expect(d.logOnly).toBe(true);
    expect(d.corrections).toEqual([]);
  });
});

describe("SessionController — log-only mode (Part 6 §3.6, no def)", () => {
  it("does not analyze, does not throw, and reports analysisAvailable=false", () => {
    const c = new SessionController();
    c.startSet("bench_press", 1); // no definition bundled
    expect(c.analysisAvailable).toBe(false);

    const d = c.feed([{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }], 0, true);
    expect(d.logOnly).toBe(true);
    expect(d.rep_count).toBeNull(); // manual counting owns it
    expect(d.form_correct).toBeNull(); // no grading
    expect(c.endSet()).toBeNull();
  });
});
