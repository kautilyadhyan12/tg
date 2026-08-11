// A stretch the engine could not watch must never be billed as exercise.
//
// THE DEFECT, AS KD SAW IT: 14 reps reported 22 kcal, and he asked whether that
// could be right (DECISIONS :7222). It was not — 171.7 s were charged at the
// squat MET inside a workout whose timer ran 161.0 s, which is more vigorous
// exercise than the workout lasted.
//
// THE CAUSE IS HERE, not in the calorie sum. A rep's clock starts when the
// metric leaves the top (`fsm.ts`, `cycleStartT ??= t`) and is cleared only by a
// COMPLETED rep, while a frame with no usable metric HOLDS everything (§3.1
// fail-soft, the correct behaviour for counting). So a user who begins a squat
// and then stops being measurable — walks out of shot, rests without pausing, is
// occluded, or is silenced by the person check — has that entire absence charged
// to the next rep. `reps × tempoMsAvg` is what the server bills, so the absence
// arrives as calories.
//
// WHY THE ABSENCE IS FED AS FRAMES WITH NO KEYPOINTS: that is production, not a
// convenience. The web bridge hands a blocked frame to the engine with no
// landmarks (`sessionController.js`: `this._session.feed(scene.blocked ? [] :
// landmarks, tMs)`), and the adapter maps that to `{ t, kp: [] }`. Timestamps
// keep advancing throughout, because the clock does not stop when the camera
// stops seeing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseDefinitionSchema, type ExerciseDefinition, type PoseFrame } from "@app/shared";
import { compileDefinition, createSession, parseTrace, type RepEvent } from "../src/index.js";

/** This package's own recording — a test that reads outside the package makes
 *  the turbo cache lie (CLAUDE.md Part IV #10). */
const TRACE = join(import.meta.dirname, "traces/parity/squat_sideview2goodform.jsonl");
const DEF = join(import.meta.dirname, "../src/definitions/squat.json");

/** The app's engine feed interval (`usePoseDetection.js` FEED_INTERVAL_MS). */
const FRAME_MS = 67;

/** Two minutes away from the camera. Kd's own smoke left the room for exactly
 *  this long, and it is the sweep length the defect was measured at (:7222). */
const ABSENCE_MS = 120_000;

function squatFrames(): readonly PoseFrame[] {
  return parseTrace(readFileSync(TRACE, "utf8")).frames;
}

function squatSession() {
  const raw: unknown = JSON.parse(readFileSync(DEF, "utf8"));
  const def: ExerciseDefinition = exerciseDefinitionSchema.parse(raw);
  return createSession(compileDefinition(def, 1));
}

interface Run {
  readonly reps: number;
  readonly tempoMsAvg: number | null;
  readonly repDurations: readonly number[];
  /** Wall span of the frames as fed, first to last. */
  readonly spanMs: number;
}

function run(frames: readonly PoseFrame[]): Run {
  const session = squatSession();
  const events: RepEvent[] = [];
  session.onRep?.((e) => events.push(e));
  for (const f of frames) session.processFrame(f);
  const summary = session.end();
  const first = frames[0];
  const last = frames[frames.length - 1];
  return {
    reps: summary?.reps ?? 0,
    tempoMsAvg: summary?.tempoMsAvg ?? null,
    repDurations: events.map((e) => e.durationMs),
    spanMs: first !== undefined && last !== undefined ? last.t - first.t : 0,
  };
}

/**
 * The same clip with the camera losing the user at `atIndex` for `gapMs`.
 *
 * Nothing about the MOVEMENT changes — the same frames, in the same order, with
 * the same spacing. Only an unwatched stretch is spliced in, and the timestamps
 * after it move by exactly that much. So any change in what the app thinks a rep
 * took is the defect and not the clip.
 */
function withAbsence(
  frames: readonly PoseFrame[],
  atIndex: number,
  gapMs: number,
): readonly PoseFrame[] {
  const head = frames.slice(0, atIndex);
  const lastSeen = head[head.length - 1];
  const from = lastSeen === undefined ? 0 : lastSeen.t;
  const blanks: PoseFrame[] = [];
  for (let t = from + FRAME_MS; t <= from + gapMs; t += FRAME_MS) blanks.push({ t, kp: [] });
  const tail = frames.slice(atIndex).map((f) => ({ t: f.t + gapMs, kp: f.kp }));
  return [...head, ...blanks, ...tail];
}

describe("an absence is not exercise", () => {
  it("counts the untouched recording as it always has", () => {
    // THE CONTROL. Everything below compares against this, so if the clip or the
    // definition ever stops producing a clean two-rep read, the sweep is
    // measuring something else and says so here first.
    const clean = run(squatFrames());
    expect(clean.reps).toBeGreaterThan(0);
    expect(clean.tempoMsAvg).not.toBeNull();
    // A real squat is seconds, not minutes — stated so a wrong control cannot
    // pass for a right one.
    expect(clean.tempoMsAvg).toBeLessThan(10_000);
  });

  it("never bills more exercise than the engine actually watched, wherever the absence falls", () => {
    // THE CLAIM, and it is deliberately the SERVER'S OWN ARITHMETIC rather than a
    // tidier one: `reps × tempoMsAvg` is exactly what `kcalPointForSetsV2` charges
    // at the exercise MET. The time the engine could actually see is the span
    // minus the spliced absence. Billing more than that is the defect, in the
    // same units the user was shown.
    //
    // SWEPT, not sampled at one point. The first draft of this test inserted the
    // absence at a single index and would have passed on any index that happens
    // to fall between cycles — the same vacuity that made two of the person
    // check's fixtures worthless (:7298). Every frame boundary is tried.
    const frames = squatFrames();
    const offenders: { at: number; billedMs: number; watchedMs: number }[] = [];
    for (let at = 1; at < frames.length; at++) {
      const gapped = run(withAbsence(frames, at, ABSENCE_MS));
      const billedMs = gapped.reps * (gapped.tempoMsAvg ?? 0);
      const watchedMs = gapped.spanMs - ABSENCE_MS;
      if (billedMs > watchedMs) offenders.push({ at, billedMs, watchedMs });
    }
    expect(
      offenders.slice(0, 5),
      `${String(offenders.length)} of ${String(frames.length - 1)} absence positions bill ` +
        `unwatched time as exercise (worst first five shown)`,
    ).toEqual([]);
  });

  it("does not let one rep swallow the absence", () => {
    // The same defect stated as the thing a user could read on a set: a single
    // rep credited with minutes. Kept separate from the billing claim above
    // because a future fix could make the totals honest while still reporting one
    // absurd rep — the tempo of a set is shown, and :5807 makes a wrong number on
    // screen Critical whatever the totals do.
    const frames = squatFrames();
    const worst = frames.slice(1).reduce<number>((max, _f, i) => {
      const gapped = run(withAbsence(frames, i + 1, ABSENCE_MS));
      return Math.max(max, ...gapped.repDurations);
    }, 0);
    expect(worst).toBeLessThan(ABSENCE_MS);
  });
});
