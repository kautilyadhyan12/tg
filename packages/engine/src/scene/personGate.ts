// The person gate: "does what the camera is looking at move like a body?"
// Camera-accuracy card, phase 2, card 4.
//
// ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
// Kd's second recording session counted 6, 2, 0 and 2 reps across four clips of
// an EMPTY ROOM containing a chair (DECISIONS :6856) — ten reps invented from
// furniture. Nothing in the app asks whether the 33 landmarks it is handed came
// from a person: a frame is valid if the numbers are finite, and a chair reports
// the same 0.99 confidence a person does (:6386). This is the thing that asks.
//
// ── WHAT IT DOES AND DOES NOT DECIDE ────────────────────────────────────────
// It answers ONE question per frame: block, or do not block. It does not stop
// the camera, does not end the set, does not change who owns the set, and does
// not choose its own numbers — the cut-offs are constructor arguments, ruled by
// Kd on measured evidence and passed in from the WEB BRIDGE, which also owns
// what the screen then says. This file is the arithmetic and nothing else.
// (2026-08-07 ruling: a scene check does not belong inside the engine pipeline;
// the engine is handed 33 numbers and cannot know where they came from.)
//
// ── THE TWO RULES THAT KEEP IT SAFE ─────────────────────────────────────────
// 1. **NO READING MEANS PASS.** Until the window holds enough real readings —
//    the first second of a set, or a stretch where the model reported nothing —
//    `blocked` is false and the app counts exactly as it does today. A gate that
//    defaulted to "block" would take counting away on no evidence, which is the
//    harmful direction: being wrongly ignored mid-squat is worse than a chair
//    sneaking through (a chair sneaking through is merely today's behaviour).
// 2. **ONE DIRECTION.** Every signal runs higher = more like furniture, so the
//    test is always `reading > cutoff`. A signal that silently ran backwards
//    would reject real users, and the tests pin the direction rather than
//    trusting it.
//
// It cannot throw on a frame (I6): every arithmetic path in `readFrame` returns
// null rather than raising, and nothing here divides or indexes unguarded.
import type { PoseFrame } from "@app/shared";
import { MAX_GAP_MS, readFrame, RollingWindow, type SignalName } from "./discriminators.js";

export type { SignalName } from "./discriminators.js";
export { SIGNAL_NAMES } from "./discriminators.js";

/** One signal and the number above which it calls the pose "not a person". */
export interface GateRule {
  readonly signal: SignalName;
  readonly cutoff: number;
}

/**
 * How several rules combine.
 * - `any`  — block when ANY rule fires. Stricter: catches more furniture and
 *            costs more real frames.
 * - `all`  — block only when EVERY rule fires. Looser: a rule that has no
 *            reading yet holds the whole gate open, by rule 1 above.
 */
export type GateMode = "any" | "all";

export interface PersonGateOptions {
  /** At least one. Two rules with `mode` is how a combination is expressed —
   *  combining signals was never measured before card 4, so it is configuration
   *  here rather than a decision baked in. */
  readonly rules: readonly GateRule[];
  /** Frames in the rolling median. 15 ≈ 1 s at the app's 15 fps engine feed. */
  readonly window: number;
  /** Default `any`. */
  readonly mode?: GateMode;
  /** Frame pairs further apart than this are not measured (the model had lost
   *  the pose; measuring across the gap measures the gap). Default 500 ms. */
  readonly maxGapMs?: number;
}

export interface GateVerdict {
  /** true = the app must not count this frame. */
  readonly blocked: boolean;
  /** What each rule read, in `rules` order. null = not enough readings yet,
   *  which by rule 1 can never block. Exposed so a screen or a measurement can
   *  show WHY, and never re-derived by a caller. */
  readonly values: readonly (number | null)[];
}

interface Check {
  readonly rule: GateRule;
  /** Named `roll` rather than the obvious word: the engine's purity gate greps
   *  `src/` for the browser global's dotted form, so a field of that name —
   *  even a comment mentioning it — reads to that grep exactly like the DOM
   *  does, and the grep is right to be blunt. A field name is cheaper than a
   *  weakened gate. (Both of my first drafts tripped it, in comments.) */
  readonly roll: RollingWindow;
}

/**
 * Stateful, per set. Feed it every frame the app feeds the engine, in order.
 *
 * The state is one previous frame plus one rolling window per rule — a few
 * dozen numbers, no allocation growth over a session (I5).
 */
export class PersonGate {
  private readonly checks: readonly Check[];
  private readonly mode: GateMode;
  private readonly maxGapMs: number;
  private previous: PoseFrame | null = null;

  constructor(options: PersonGateOptions) {
    if (options.rules.length === 0) {
      // A gate with no rules would answer "never block" while looking like a
      // gate — a stub that returns success, which R1.3 forbids outright.
      throw new Error("PersonGate needs at least one rule");
    }
    this.checks = options.rules.map((rule) => ({
      rule,
      roll: new RollingWindow(options.window),
    }));
    this.mode = options.mode ?? "any";
    this.maxGapMs = options.maxGapMs ?? MAX_GAP_MS;
  }

  /** One frame in, one verdict out. */
  push(frame: PoseFrame): GateVerdict {
    const reading = readFrame(frame, this.previous, this.maxGapMs);
    this.previous = frame;

    const values: (number | null)[] = [];
    const fired: boolean[] = [];
    for (const check of this.checks) {
      const value = check.roll.push(reading[check.rule.signal]);
      values.push(value);
      fired.push(value !== null && value > check.rule.cutoff);
    }
    const blocked = this.mode === "any" ? fired.includes(true) : !fired.includes(false);
    return { blocked, values };
  }

  /** Start again: a new set is not a continuation of the last one, and neither
   *  is a resumed one — the frame before a pause is not the frame before now. */
  reset(): void {
    this.previous = null;
    for (const check of this.checks) check.roll.reset();
  }
}
