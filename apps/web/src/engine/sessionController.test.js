import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseTrace } from "@app/engine";
import { PersonGate } from "@app/engine/scene";
import {
  burstShakenSquat,
  goldenSquat,
  shakenSquat,
  toLandmarks,
} from "./__fixtures__/sceneClips.js";
import { getDefinition, startSet as adapterStartSet } from "./poseAdapter.js";
import { PERSON_GATE, SceneGate } from "./sceneGate.js";
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
  const RECOVERED_CUE = /lost sight of you for a moment/;
  const ENGINE_CUE = /step back/i;

  /**
   * What the SHIPPED gate says about each frame, frame by frame.
   *
   * Every "how many frames" assertion below is stated against this rather than
   * as a floor. A floor grades on a curve: ">50 frames blocked" is satisfied by
   * a cut-off loosened until it barely works, which is exactly how mutant PG1
   * survived the first sweep (:7104). An exact set cannot be.
   */
  function oracle(frames) {
    const scene = new SceneGate();
    return frames.map((f) => scene.push(f));
  }

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

  it("says on screen that it is not counting, on exactly the frames it is not counting", () => {
    // The silence is 4.5% of a squatting person's frames, in runs of up to
    // ~1.5 s (:7054). A count that sits still with no explanation is the app
    // telling the user something false by omission (:5807).
    //
    // Set equality, not a count: the sentence must appear on every frame the
    // gate is blocking with the message raised, and on no other.
    const frames = shakenSquat(0.05);
    const want = oracle(frames).map((v) => v.showMessage && v.blocked);
    const { displays } = bridge(frames);
    expect(displays.map((d) => SCENE_CUE.test(d.corrections[0] ?? ""))).toEqual(want);
    expect(want.filter(Boolean).length).toBeGreaterThan(0); // the fixture does block
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
    // EVERY field of the ruling, named. A bare gate that quietly omitted one
    // would read differently from the shipped one and this test would then be
    // comparing the bridge against the wrong oracle — which is exactly what
    // happened when `nominalDtMs` was added: without it here, the oracle keeps
    // reading at the real frame interval while the bridge reads at the ruled
    // one. What stops that recurring is the whole-object assertion in
    // `sceneGate.test.js`: a new field in the ruling turns it red, and this
    // site is the reason it must.
    const bare = new PersonGate({
      rules: [{ signal: PERSON_GATE.signal, cutoff: PERSON_GATE.cutoff }],
      window: PERSON_GATE.window,
      nominalDtMs: PERSON_GATE.nominalDtMs,
    });
    const blocked = frames.map((f) => bare.push(f).blocked);
    expect(blocked).toEqual(oracle(frames).map((v) => v.blocked));

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
    const frames = shakenSquat(0.05);
    const want = oracle(frames).map((v) => v.showMessage && v.blocked);
    const { displays } = bridge(frames);
    const speaking = displays.filter((_, i) => want[i]);
    expect(speaking.length).toBe(want.filter(Boolean).length);
    expect(speaking.length).toBeGreaterThan(0);
    expect(speaking.every((d) => d.form_correct === null)).toBe(true);
  });

  // ── THE SENTENCE MUST BE TRUE OF THE FRAME IT IS ON ────────────────────────

  it("never says 'not counting' on a frame where it counted a rep", () => {
    // THE DEFECT, stated as the thing a user could see. The message is held for
    // up to fourteen frames after blocking stops so that it can be READ — but
    // counting resumes on the FIRST clean frame, so the count rose and the rep
    // beep sounded underneath a sentence saying neither was happening. Measured
    // on four of the six clips of Kd himself.
    const frames = burstShakenSquat();
    const want = oracle(frames);
    const { displays } = bridge(frames);

    const countedAt = [];
    let previous = 0;
    displays.forEach((d, i) => {
      if (typeof d.rep_count !== "number") return;
      if (d.rep_count > previous) countedAt.push(i);
      previous = d.rep_count;
    });
    countedAt.forEach((i) => {
      expect(SCENE_CUE.test(displays[i].corrections[0] ?? "")).toBe(false);
    });

    // THE CONTROLS, and they are the whole test. The assertion above is TRUE OF
    // AN EMPTY LIST, so a fixture whose reps all land outside the message —
    // which is what the first draft of this test had, and it stayed green with
    // the defect restored — proves nothing at all. These pin that the fixture
    // reaches the state: it counts its reps, it raises the sentence, and at
    // least one rep is counted while the sentence is still on screen.
    expect(countedAt.length).toBe(2);
    expect(want.some((v) => v.showMessage && v.blocked)).toBe(true);
    const tail = want.map((v, i) => (v.showMessage && !v.blocked ? i : -1)).filter((i) => i >= 0);
    expect(countedAt.filter((i) => tail.includes(i)).length).toBeGreaterThan(0);
  });

  it("switches to the past tense for the rest of the message, and counts through it", () => {
    // The state the gate calls `showMessage && !blocked`: counting has resumed
    // and the explanation of the pause is still on screen. It must describe a
    // moment that has ENDED, and the frames must be graded like any other —
    // withholding the verdict here would be the same defect one degree quieter.
    const frames = burstShakenSquat();
    const want = oracle(frames);
    const { displays } = bridge(frames);
    const tail = displays.filter((_, i) => want[i].showMessage && !want[i].blocked);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((d) => RECOVERED_CUE.test(d.corrections[0] ?? ""))).toBe(true);
    expect(tail.every((d) => !SCENE_CUE.test(d.corrections[0] ?? ""))).toBe(true);
  });

  it("lets a real engine cue through once counting has resumed", () => {
    // The tail sentence explains a pause that is over; a live cue is about the
    // frame in front of the user. Left unordered, "cannot see your legs
    // clearly" was suppressed for up to fourteen frames after every block.
    // Block first, then feed frames the GATE is happy with and the ENGINE
    // cannot measure — a still body with its legs faded out. The gate needs a
    // few frames to work the blocked readings out of its rolling window, and
    // the message runs on past that, so the two states overlap by construction.
    const legless = goldenSquat().frames[0].kp.map(([x, y, z, v], i) =>
      i >= 25 ? [x, y, z, 0.05] : [x, y, z, v],
    );
    const frames = shakenSquat(0.05)
      .slice(0, 40)
      .concat(Array.from({ length: 30 }, (_, i) => ({ t: 5000 + i * 67, kp: legless })));

    const want = oracle(frames);
    const { displays } = bridge(frames);
    const tail = frames
      .map((_, i) => i)
      .filter((i) => want[i].showMessage && !want[i].blocked);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.some((i) => ENGINE_CUE.test(displays[i].corrections[0] ?? ""))).toBe(true);
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

    c.framesResumed();
    // A frame of the real recording, a long way later in wall time — which is
    // what coming back from a pause looks like.
    d = c.feed(toLandmarks(goldenSquat().frames[0].kp), 100000, true);
    expect(SCENE_CUE.test(d.corrections[0] ?? "")).toBe(false);
    expect(d.form_correct).not.toBeNull();
  });

  it("forgets the occlusion streak when a paused set resumes, not just the scene check", () => {
    // The streak counts CONSECUTIVE unusable frames. Two before a pause plus one
    // after it used to raise "cannot see your legs clearly" on the first frame
    // back — a cue about a run of frames that never happened. The check itself
    // was reset here from the start; this counter was missed.
    const legsHidden = Array.from({ length: 33 }, (_, i) => ({
      x: 0.5,
      y: 0.3,
      z: 0,
      visibility: i >= 23 ? 0.01 : 1.0,
    }));
    const c = new SessionController();
    c.startSet("squat", 1);
    const cueAt = (t) => ENGINE_CUE.test(c.feed(legsHidden, t, true).corrections[0] ?? "");
    cueAt(0);
    expect(cueAt(67)).toBe(false); // two is not yet three

    c.framesResumed();
    expect(cueAt(100000)).toBe(false);
    // THE CONTROL: three IN A ROW after the resume still raises it.
    cueAt(100067);
    expect(cueAt(100134)).toBe(true);
  });

  it("TELLS THE ENGINE it stopped watching — the half a rename would drop silently", () => {
    // THE CLOCK HALF, asserted on its own. The two scene assertions above pass
    // whether or not the engine is ever told, so without this the pause fix
    // could be deleted and this file would stay entirely green — which is
    // exactly how the badge guards went vacuous (:6150).
    //
    // Measured through the REAL engine rather than a spy, because a spy would
    // only prove a call happened, not that it moves the number the server bills
    // from. A pause is spliced by advancing the timestamps with NO frames in
    // between — production, since the app tears the feed down.
    const frames = goldenSquat().frames;
    const PAUSE = 120000;
    const watchedWith = (told) => {
      const c = new SessionController();
      c.startSet("squat", 1);
      const at = Math.floor(frames.length / 2);
      frames.forEach((f, i) => {
        const t = i < at ? f.t : f.t + PAUSE;
        if (i === at && told) c.framesResumed();
        c.feed(toLandmarks(f.kp), t, true);
      });
      return c.endSet().watchedMs;
    };
    const undeclared = watchedWith(false);
    const declared = watchedWith(true);
    // The control: without the call the pause IS inside watched time. If this
    // stops holding the fixture no longer reproduces the defect and the claim
    // below proves nothing.
    expect(undeclared).toBeGreaterThan(PAUSE);
    // The claim: declaring it takes the whole pause out.
    expect(undeclared - declared).toBeGreaterThanOrEqual(PAUSE);
  });

  it("does not run at all in log-only mode", () => {
    // Nothing to protect: the user is counting, so there are no reps to invent
    // and none to take away. framesResumed must not throw where there is neither a
    // check nor an engine session to tell.
    const c = new SessionController();
    c.startSet("bench_press", 1);
    expect(() => c.framesResumed()).not.toThrow();
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
