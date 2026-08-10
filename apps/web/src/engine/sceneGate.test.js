// The person check as the app uses it: the ruled numbers, and when the screen
// speaks.
//
// TWO KINDS OF TEST, deliberately, because they answer different questions.
//   1. Against the REAL gate — does the number Kd ruled still do what he ruled
//      it for? These are the ones a drifting cut-off cannot survive.
//   2. Against an injected FAKE gate — the message rules. With the real gate
//      every verdict depends on 15 frames of accumulated geometry, so a test of
//      "three in a row" would have to hand-build a clip that blocks on exactly
//      frames 4, 5 and 6, and would then be testing the fixture.
import { describe, expect, it } from "vitest";
import {
  FRAME_MS,
  furnitureClip,
  personClip,
  shakenSquat,
} from "./__fixtures__/sceneClips.js";
import {
  BLOCKED_RUN_BEFORE_MESSAGE,
  CLEAN_RUN_BEFORE_MESSAGE_CLEARS,
  PERSON_GATE,
  SceneGate,
} from "./sceneGate.js";

/** Every frame's verdict for a clip, through the REAL, ruled gate. */
function run(frames) {
  const scene = new SceneGate();
  return frames.map((f) => scene.push(f));
}

// ── 1. Kd's ruling ──────────────────────────────────────────────────────────

describe("the numbers that ship are the numbers Kd ruled", () => {
  it("is bone_stretch above 0.923, on a 15-frame window, and nothing else", () => {
    // DECISIONS.md:7041. This is not a style assertion: `motion_incoherence`
    // scored an indistinguishable 0.980 separation and LOSES A REAL REP in both
    // recording sessions, so a second rule appearing here — or a nudged cut-off
    // — is a silent reversal of a ruling made on measured evidence.
    // `nominalDtMs` is part of the SAME ruling, not an addition to it: without
    // it 0.923 meant a different strictness on every machine, because the signal
    // is reported per second and the app's frame interval is a floor, not a
    // guarantee. Measured pooled median of the thirteen clips the ruling was
    // made on.
    expect(PERSON_GATE).toEqual({
      signal: "bone_stretch",
      cutoff: 0.923,
      window: 15,
      nominalDtMs: 82,
    });
  });

  it("never blocks a body whose bones keep their lengths", () => {
    // The harmful direction, and the one the cut-off was pinned by: a real user
    // being told the camera cannot see them while they squat.
    const verdicts = run(personClip(200));
    expect(verdicts.some((v) => v.blocked)).toBe(false);
    expect(verdicts.some((v) => v.showMessage)).toBe(false);
  });

  it("blocks a skeleton that is redrawn every frame, and then never lets one through", () => {
    // The whole point of the card. Stated as "once it starts, not one frame
    // gets past" rather than as a share, because a share is satisfied by a
    // cut-off that has been loosened until it barely works: the audit's PG1
    // raises the number tenfold, and an assertion that merely counted the
    // majority of frames stayed GREEN through it. Every reading on this clip is
    // an order of magnitude above the ruled cut-off, so leaks are not a matter
    // of degree here — one leaked frame means the number has moved.
    const verdicts = run(furnitureClip(200));
    const firstBlock = verdicts.findIndex((v) => v.blocked);
    expect(firstBlock).toBeGreaterThan(0); // the warm-up passes, by rule 1
    expect(firstBlock).toBeLessThan(15); // and it takes under a second to decide
    expect(verdicts.slice(firstBlock).every((v) => v.blocked)).toBe(true);
  });

  it("says so on screen when it blocks", () => {
    const verdicts = run(furnitureClip(200));
    expect(verdicts.at(-1).showMessage).toBe(true);
  });

  it("reads nothing, and so blocks nothing, until the window has filled", () => {
    // "No reading means pass" is load-bearing: the first second of every set
    // would otherwise be taken away from the user on no evidence at all.
    //
    // Stated as the exact boundary, not a comfortable margin. The window needs
    // `ceil(15/2)` = 8 real readings and the first frame has no predecessor, so
    // frame 9 is the earliest that can block; an earlier draft checked 7 and
    // would have stayed green if the warm-up had been shortened by a frame.
    const verdicts = run(furnitureClip(200));
    expect(verdicts.slice(0, 8).every((v) => v.blocked === false)).toBe(true);
    expect(verdicts.findIndex((v) => v.blocked)).toBe(8);
  });

  it("reaches the same verdict on a fast machine as on a slow one", () => {
    // THE SECOND HALF OF THE RULING, and the one that was missing.
    //
    // `bone_stretch` is reported as a rate per SECOND, so the same frames read
    // higher when they arrive closer together. `FEED_INTERVAL_MS` is only a
    // FLOOR — Kd's laptop achieved ~82 ms and a quicker machine reaches 67 —
    // so before this the shipped gate was ~1.22× stricter on faster hardware
    // and silenced about twice as many frames. Replayed over his own thirteen
    // recordings at the app's floor, that cost a REAL rep on two of the six
    // clips containing him: the exact harm `motion_incoherence` was rejected
    // for (:7062), arriving through the back door on hardware nobody owns yet.
    //
    // A bone does not change length when its owner moves, so the honest reading
    // was never a rate in the first place. Stated as a property rather than a
    // number: the verdict is a function of the FRAMES, and timestamps decide
    // only whether a pair is close enough to measure at all.
    // THE FIXTURE IS THE TEST HERE, and the first draft's was worthless. A clip
    // of obvious furniture reads an order of magnitude above the cut-off and a
    // clean body an order below, so doubling every reading moves NO verdict and
    // the assertion passed with the defect fully restored. A gate lives in the
    // tails: this shake amount is the one measured to sit ON the cut-off — 43 of
    // 109 frames blocked — and without the fix 101 of those 109 verdicts change
    // between the two cadences.
    const frames = shakenSquat(0.035);
    const at = (ms) => run(frames.map((f, i) => ({ t: i * ms, kp: f.kp })));
    const slow = at(100).map((v) => v.blocked);
    const fast = at(50).map((v) => v.blocked);
    expect(fast).toEqual(slow);
    // And the fixture really is on the boundary, not comfortably one side of it.
    expect(slow.filter(Boolean).length).toBeGreaterThan(20);
    expect(slow.filter((b) => !b).length).toBeGreaterThan(20);
  });

  it("keeps counting through frames it cannot measure at all", () => {
    // A frame with no landmarks yields no reading. The engine already handles
    // that (hold, count nothing); the check must not ALSO fire, or a brief
    // dropout would be reported to the user as "that isn't a person".
    const scene = new SceneGate();
    for (let i = 0; i < 40; i++) {
      expect(scene.push({ t: i * FRAME_MS, kp: [] }).blocked).toBe(false);
    }
  });
});

// ── 2. When the screen speaks ───────────────────────────────────────────────

/** A gate that blocks exactly when told to, so the message rules can be stated
 *  as the sequence they are. `blocked` beyond the script repeats the last value. */
function scripted(pattern) {
  let i = 0;
  let last = false;
  return {
    push() {
      last = i < pattern.length ? pattern[i] : last;
      i += 1;
      return { blocked: last, values: [null] };
    },
    reset() {
      i = 0;
      last = false;
    },
  };
}

/** Feed n frames and return the last verdict. */
function after(scene, n) {
  let verdict = null;
  for (let i = 0; i < n; i++) verdict = scene.push({ t: i * FRAME_MS, kp: [] });
  return verdict;
}

describe("the message appears only once the silence means something", () => {
  it("stays quiet through two blocked frames", () => {
    // Two frames is ~130 ms. A sentence that appears and vanishes inside that
    // is not an explanation, it is a flicker.
    const scene = new SceneGate(scripted([true, true]));
    expect(after(scene, 2).showMessage).toBe(false);
  });

  it("appears on the third", () => {
    const scene = new SceneGate(scripted([true, true, true]));
    expect(after(scene, 3).showMessage).toBe(true);
    expect(BLOCKED_RUN_BEFORE_MESSAGE).toBe(3);
  });

  it("counts blocked frames IN A ROW, not blocked frames in total", () => {
    // Blocked, clear, blocked, clear, blocked is not a silence worth explaining.
    const scene = new SceneGate(scripted([true, false, true, false, true, false]));
    expect(after(scene, 6).showMessage).toBe(false);
  });
});

describe("the message stays up long enough to read", () => {
  it("survives a single clean frame in the middle of the blocking", () => {
    const scene = new SceneGate(scripted([true, true, true, false, true]));
    expect(after(scene, 5).showMessage).toBe(true);
  });

  it("is still up after fourteen clean frames", () => {
    const scene = new SceneGate(scripted([true, true, true, false]));
    expect(after(scene, 3 + 14).showMessage).toBe(true);
  });

  it("goes after fifteen", () => {
    // ~1 s at the app's engine feed, and the gate's own window length.
    const scene = new SceneGate(scripted([true, true, true, false]));
    expect(after(scene, 3 + 15).showMessage).toBe(false);
    expect(CLEAN_RUN_BEFORE_MESSAGE_CLEARS).toBe(15);
  });

  it("does not block while it is still explaining itself", () => {
    // The message outlives the blocked frames deliberately. Counting must NOT:
    // the moment the camera is happy again the reps resume, which is the whole
    // reason the clean-run rule is about the message and not about the gate.
    //
    // THIS PAIR OF FLAGS IS A REAL STATE AND USED TO BE A LIE. `showMessage`
    // with `blocked` false means "counting, and the screen is still explaining
    // the pause that just ended" — and the bridge printed a present-tense "Not
    // counting" through all of it, over a rising count. That the GATE is right
    // here is exactly why the defect was invisible from this file; the sentence
    // is chosen in `sessionController`, and its suite is where the honesty of
    // this state is now pinned.
    const scene = new SceneGate(scripted([true, true, true, false]));
    const verdict = after(scene, 3 + 5);
    expect(verdict.showMessage).toBe(true);
    expect(verdict.blocked).toBe(false);
  });
});

describe("starting again", () => {
  it("forgets the message and the run when a set resumes", () => {
    const scene = new SceneGate(scripted([true, true, true]));
    expect(after(scene, 3).showMessage).toBe(true);
    scene.reset();
    expect(after(scene, 1).showMessage).toBe(false);
  });

  it("forgets the gate's own history too", () => {
    // The rolling median must not carry readings from before a pause: the frame
    // before the break is not the frame before now.
    const gate = scripted([true, true, true]);
    let resets = 0;
    const scene = new SceneGate({
      push: (f) => gate.push(f),
      reset: () => {
        resets += 1;
        gate.reset();
      },
    });
    scene.reset();
    expect(resets).toBe(1);
  });
});
