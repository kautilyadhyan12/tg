// THE PERSON CHECK, AS THE APP ACTUALLY USES IT.
// Camera-accuracy card, phase 2, card 4, step 3 — the wiring.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
// Kd recorded four clips of an empty room containing a chair and the app
// counted 6, 2, 0 and 2 reps off it — ten reps invented from furniture
// (DECISIONS :6856). Nothing in the app asked whether the 33 landmarks it was
// handed came from a person: a frame is valid if its numbers are finite, and a
// chair reports the same 0.99 confidence a person does (:6386).
//
// `PersonGate` (packages/engine/src/scene) is the arithmetic that asks. It
// chooses nothing — signal, cut-off and window are arguments. THIS file is
// where they are chosen, because the 2026-08-07 ruling puts the decision and
// the screen in the web bridge, not in the engine.
//
// ── THE NUMBERS ARE KD'S RULING. DO NOT RE-DERIVE THEM (R5.4). ──────────────
// `bone_stretch > 0.923`, that signal ALONE — DECISIONS.md:7041, ruled on a
// printed table showing the cost on both sides. Measured over all 13 recorded
// clips and replayed through the real engine: 11 invented reps became 3, and
// all 66 reps on the six clips containing Kd were still counted (:7057).
// `motion_incoherence` scored 0.980 separation against bone_stretch's 0.983 —
// indistinguishable on paper — and LOSES A REAL REP IN BOTH SESSIONS, so it is
// out, as is every combination containing it (:7062-7067). A later chat that
// re-opens this from a separation number will pick the rep-eating signal.
//
// The window and the gap guard are not decoration either: they are the values
// the ruling was MEASURED at (`scripts/measure-pose.ts:812-813` defaults, and
// `MAX_GAP_MS` in the same scene module). Change one and the number Kd approved
// stops describing what ships.
import { PersonGate } from "@app/engine/scene";

/** Kd's ruling, in one frozen object so a later edit cannot scatter it.
 *  `maxGapMs` is deliberately absent: the gate defaults to the same MAX_GAP_MS
 *  the measurement used, and naming it here would create a second declaration
 *  of one rule — which is where a correction gets lost (:4556 F1). */
export const PERSON_GATE = Object.freeze({
  signal: "bone_stretch",
  cutoff: 0.923,
  /** Frames in the rolling median. 15 ≈ 1 s at the app's ~15 fps engine feed
   *  (usePoseDetection.js FEED_INTERVAL_MS), and the default the ruling was
   *  measured at. */
  window: 15,
  /** THE CADENCE THE CUT-OFF WAS MEASURED AT. Not a second threshold — it is
   *  part of the FIRST one, and leaving it out made 0.923 mean different things
   *  on different machines.
   *
   *  `bone_stretch` is reported as a rate per second, so it reads higher when
   *  frames arrive closer together — but a bone does not change length when its
   *  owner moves, so almost all of what it measures is per-frame estimator
   *  noise that does not grow with the gap. Kd's thirteen clips ARE the app's
   *  own engine feed on his laptop (`usePoseDetection.js` records inside the
   *  same interval check that feeds the engine), pooled median 82.1 ms over
   *  12,075 measured pairs. `FEED_INTERVAL_MS` is only a FLOOR, so a quicker
   *  machine reaches ~67 ms, reads ~1.22× higher, and silences about twice as
   *  many frames — measured on these clips, it costs a real rep on two of the
   *  six containing Kd, which is the exact harm `motion_incoherence` was
   *  rejected for (:7062).
   *
   *  Fixing the conversion here makes the verdict a function of the FRAMES and
   *  not of the machine, and it reproduces the ruled table on the ruled clips
   *  exactly — 3 invented reps left on `chair_A`, all 66 of Kd's own reps kept.
   *  That equality is asserted in this module's suite; if it ever breaks, the
   *  shipped gate has stopped being the one Kd approved. */
  nominalDtMs: 82,
});

// ── WHEN THE SCREEN SPEAKS, AND WHEN IT STOPS ───────────────────────────────
//
// 4.5% of a squatting person's frames are silenced by this gate, in runs of up
// to 18 frames — about a second and a half (:7054, :7084). A user who squats
// and watches the count sit still with no explanation has been told something
// false by omission (:5807), so the screen must say it is not counting. But a
// message that appears for one frame and vanishes is not an explanation either;
// the measurement script prints the LONGEST run for exactly this reason ("4% of
// frames blocked in ones and twos is a message that flickers, while 4% in one
// run is a message that appears once and means something").
//
// So: on after three blocked frames in a row, off after fifteen clean ones.

/** Blocked frames in a row before the message appears.
 *
 *  Not a number of mine: it is §3.1's own count, the same one the engine uses
 *  to decide that it has lost sight of the user (`INVALID_STREAK_FOR_VISIBILITY`
 *  in pipeline/ingest.ts). That makes the message appear at exactly the frame
 *  where the engine — fed the blanked frames we hand it — would otherwise put
 *  its OWN sentence on screen, "cannot see your legs clearly, step back". That
 *  sentence names a cause the app cannot know while the user is standing in
 *  full view, which is the defect found at :6150. One message replaces the
 *  other; they never appear together. */
export const BLOCKED_RUN_BEFORE_MESSAGE = 3;

/** Clean frames in a row before the message goes.
 *
 *  A UI patience threshold in the tradition of `ENGINE_STALL_MS` — the spec
 *  names no figure and this one is not measured, it is chosen so the sentence
 *  can be READ. 15 frames is ~1 s at the app's engine feed, and it is the gate's
 *  own window length: while any of the blocked readings can still be inside the
 *  rolling median that produced them, the message that explains them stays up.
 *  Without an off-delay, blocking that arrives in ones and twos flashes the
 *  message on and off several times a second. */
export const CLEAN_RUN_BEFORE_MESSAGE_CLEARS = 15;

/**
 * The gate plus the screen's own hysteresis, per set.
 *
 * `gate` is injected for one reason and it is not tidiness: with the real gate,
 * every verdict depends on 15 frames of accumulated geometry, so a test of the
 * MESSAGE rules would have to build a clip that blocks on exactly the frames it
 * wants — which tests the fixture, not the rule. The default is the real,
 * ruled gate; `sessionController` never passes an argument. The ruled numbers
 * are pinned separately, against the real gate, in this module's own suite.
 */
export class SceneGate {
  constructor(gate = null) {
    this._gate =
      gate ??
      new PersonGate({
        rules: [{ signal: PERSON_GATE.signal, cutoff: PERSON_GATE.cutoff }],
        window: PERSON_GATE.window,
        nominalDtMs: PERSON_GATE.nominalDtMs,
      });
    this._blockedRun = 0;
    this._cleanRun = 0;
    this._message = false;
  }

  /**
   * One frame in, one verdict out.
   *
   * The frame handed in here is ALWAYS the real one, including on frames this
   * gate goes on to block. The offline simulation Kd ruled on did exactly that
   * (`measure-pose.ts`: it pushes every recorded frame into the gate and hands
   * the ENGINE a blank one), and a gate fed its own blanked output would read a
   * different rolling median from the table that chose its number.
   */
  push(frame) {
    const blocked = this._gate.push(frame).blocked;
    if (blocked) {
      this._cleanRun = 0;
      this._blockedRun += 1;
      if (this._blockedRun >= BLOCKED_RUN_BEFORE_MESSAGE) this._message = true;
    } else {
      this._blockedRun = 0;
      this._cleanRun += 1;
      if (this._cleanRun >= CLEAN_RUN_BEFORE_MESSAGE_CLEARS) this._message = false;
    }
    return { blocked, showMessage: this._message };
  }

  /** Start again — a new set, or a set resumed after a pause. The frame before
   *  a pause is not the frame before now, and a message left over from before
   *  the pause would explain something the user can no longer see. */
  reset() {
    this._gate.reset();
    this._blockedRun = 0;
    this._cleanRun = 0;
    this._message = false;
  }
}
