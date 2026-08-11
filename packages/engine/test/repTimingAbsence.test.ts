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
// RepEvent is a §2.4 shared payload type. The engine re-exports neither it nor
// the other @app/shared types — importing it from "../src/index.js" typechecks
// nowhere, though vitest runs it happily because esbuild strips types without
// checking them (the red-test commit shipped that way; found by `tsc` here).
import {
  exerciseDefinitionSchema,
  type ExerciseDefinition,
  type PoseFrame,
  type RepEvent,
} from "@app/shared";
import { compileDefinition, createSession, parseTrace } from "../src/index.js";

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
  /** The rep events as emitted — phase timings included. */
  readonly events: readonly RepEvent[];
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
    // `end()` returns a SetSummary, never null — the defensive `?.`/`?? 0` the
    // red-test commit carried here was dead code the broken import had hidden
    // from the linter, and it would have quietly reported "0 reps" if it ever
    // did fire.
    reps: summary.reps,
    tempoMsAvg: summary.tempoMsAvg,
    repDurations: events.map((e) => e.durationMs),
    spanMs: first !== undefined && last !== undefined ? last.t - first.t : 0,
    events,
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

// ---------------------------------------------------------------------------
// THE OTHER WAY THE CAMERA LOSES A USER — and the guards on the fix itself.
// Added 2026-08-11 with the fix. Kd approved covering both paths after the
// occluded one was measured at the same size as the absence above.
// ---------------------------------------------------------------------------

/** Real recorded frames of a person the camera CAN see and whose legs it
 *  CANNOT measure — the §7.3 partial-visibility regression clip (600 frames,
 *  sitting at a desk). Measured before this was written: all 600 are frames the
 *  engine ACCEPTS, and all 600 yield no usable rep metric. That is why it is
 *  used here rather than a hand-built pose — a synthetic body would prove
 *  nothing about production, and this clip IS production. */
const OCCLUDED_TRACE = join(
  import.meta.dirname,
  "traces/regression/squat_sitting_idle_desk_nocount.jsonl",
);

/** The two ways a user stops being watchable, both of which production
 *  produces: `blank` = no keypoints at all (out of shot, or the person check
 *  silenced the frame); `occluded` = a visible person whose legs are not
 *  measurable. The engine must treat them identically — it watched neither. */
type Lost = "blank" | "occluded";

function lostFrames(kind: Lost): readonly PoseFrame[] {
  return kind === "blank" ? [] : parseTrace(readFileSync(OCCLUDED_TRACE, "utf8")).frames;
}

/** `withAbsence` for either kind. The MOVEMENT is untouched: same frames, same
 *  order, same spacing, timestamps after the gap moved by exactly the gap. */
function withLostSight(
  frames: readonly PoseFrame[],
  atIndex: number,
  gapMs: number,
  kind: Lost,
): readonly PoseFrame[] {
  if (kind === "blank") return withAbsence(frames, atIndex, gapMs);
  const filler = lostFrames(kind);
  const head = frames.slice(0, atIndex);
  const lastSeen = head[head.length - 1];
  const from = lastSeen === undefined ? 0 : lastSeen.t;
  const blind: PoseFrame[] = [];
  let i = 0;
  for (let t = from + FRAME_MS; t <= from + gapMs; t += FRAME_MS) {
    const pose = filler[i++ % filler.length];
    if (pose !== undefined) blind.push({ t, kp: pose.kp });
  }
  const tail = frames.slice(atIndex).map((f) => ({ t: f.t + gapMs, kp: f.kp }));
  return [...head, ...blind, ...tail];
}

interface Sweep {
  /** Positions billing more exercise than the engine could watch. */
  readonly overbilled: { at: number; billedMs: number; watchedMs: number }[];
  /** The longest single rep produced anywhere in the sweep. */
  readonly worstRepMs: number;
  /** Every distinct rep count seen. A fix that moves counting shows up here. */
  readonly repCounts: number[];
  /** Every set-average tempo seen. */
  readonly tempos: (number | null)[];
  /** Any duration or phase timing below zero. */
  readonly impossible: { at: number; field: string; value: number }[];
}

const SWEEPS = new Map<Lost, Sweep>();

/** One pass over every frame boundary, collecting everything the tests below
 *  assert. Memoised: the occluded pass feeds ~157,000 frames through the full
 *  pipeline and re-running it per assertion would be the slowest thing here. */
function sweep(kind: Lost): Sweep {
  const cached = SWEEPS.get(kind);
  if (cached) return cached;
  const frames = squatFrames();
  const out: Sweep = {
    overbilled: [],
    worstRepMs: 0,
    repCounts: [],
    tempos: [],
    impossible: [],
  };
  let worst = 0;
  for (let at = 1; at < frames.length; at++) {
    const g = run(withLostSight(frames, at, ABSENCE_MS, kind));
    const billedMs = g.reps * (g.tempoMsAvg ?? 0);
    const watchedMs = g.spanMs - ABSENCE_MS;
    if (billedMs > watchedMs) out.overbilled.push({ at, billedMs, watchedMs });
    if (!out.repCounts.includes(g.reps)) out.repCounts.push(g.reps);
    out.tempos.push(g.tempoMsAvg);
    for (const e of g.events) {
      worst = Math.max(worst, e.durationMs);
      if (e.durationMs < 0) out.impossible.push({ at, field: "durationMs", value: e.durationMs });
      for (const [field, value] of Object.entries(e.phaseTimings)) {
        if (value < 0) out.impossible.push({ at, field, value });
      }
    }
  }
  const result: Sweep = { ...out, worstRepMs: worst };
  SWEEPS.set(kind, result);
  return result;
}

describe("an absence the camera can SEE is not exercise either", () => {
  // The sweep above feeds frames with NO keypoints. This one feeds the other
  // half of the same defect: every frame arrives, every frame is valid, and the
  // legs simply cannot be measured — a chair in the way, a desk, a user half
  // out of frame. Measured before the fix: it billed 127,200 ms of a set the
  // engine watched 8,400 ms of, which is the absence sweep's own worst case to
  // within 200 ms. Nothing in the committed sweep above could see it.

  it("never bills more exercise than the engine watched, wherever the occlusion falls", () => {
    const s = sweep("occluded");
    expect(
      s.overbilled.slice(0, 5),
      `${String(s.overbilled.length)} occlusion positions bill unwatched time as exercise`,
    ).toEqual([]);
  }, 60_000);

  it("does not let one rep swallow the occlusion", () => {
    expect(sweep("occluded").worstRepMs).toBeLessThan(ABSENCE_MS);
  }, 60_000);
});

describe("what the fix must NOT change", () => {
  it("counts exactly the same reps, wherever sight is lost and however", () => {
    // Non-vacuous by measurement: before the fix this was already 2 at all 84
    // positions for both kinds, so it is a real baseline the fix must hold —
    // the whole argument for touching rep timing is that COUNTING cannot move.
    const clean = run(squatFrames());
    expect(clean.reps).toBeGreaterThan(0);
    for (const kind of ["blank", "occluded"] as const) {
      expect(sweep(kind).repCounts, `${kind}: rep count moved`).toEqual([clean.reps]);
    }
  }, 60_000);

  it("never reports a negative duration or phase timing", () => {
    // The trap in the OWED note: re-arming a rep's start while its bottom-of-
    // the-rep timestamps still predate the absence yields a negative descent.
    for (const kind of ["blank", "occluded"] as const) {
      expect(sweep(kind).impossible.slice(0, 5), `${kind}: impossible timings`).toEqual([]);
    }
  }, 60_000);

  it("keeps the set's average tempo inside the range of the reps it watched", () => {
    // The OTHER trap, and the one Kd found: a half-measured rep left in the
    // average drags it DOWN and under-bills every rep in the set. So the
    // average may never fall below the shortest rep actually watched, nor rise
    // above the longest. Before the fix it reached 63,500 ms.
    const clean = run(squatFrames());
    const lo = Math.min(...clean.repDurations);
    const hi = Math.max(...clean.repDurations);
    for (const kind of ["blank", "occluded"] as const) {
      for (const tempo of sweep(kind).tempos) {
        expect(tempo, `${kind}: tempoMsAvg outside the watched reps' range`).not.toBeNull();
        expect(tempo).toBeGreaterThanOrEqual(lo);
        expect(tempo).toBeLessThanOrEqual(hi);
      }
    }
  }, 60_000);

  it("ignores a blink — two unusable frames re-arm nothing, three do", () => {
    // A gate lives in its tails and so must its test (:7298). Two frames is
    // below §3.1's count of three, so nothing may be re-armed: a short gap only
    // ADDS wall time, and no rep may come back SHORTER than it was clean.
    const frames = squatFrames();
    const clean = run(frames);
    const shortened = (gapFrames: number): { at: number; rep: number }[] => {
      const hits: { at: number; rep: number }[] = [];
      for (let at = 1; at < frames.length; at++) {
        const g = run(withLostSight(frames, at, gapFrames * FRAME_MS, "blank"));
        g.repDurations.forEach((d, i) => {
          if (d < (clean.repDurations[i] ?? Number.POSITIVE_INFINITY)) hits.push({ at, rep: i });
        });
      }
      return hits;
    };
    expect(shortened(2).slice(0, 5), "a two-frame blink re-armed a rep's clock").toEqual([]);
    // …and the same sweep one frame longer MUST re-arm something, or the claim
    // above is satisfied by a fix that does nothing at all.
    expect(shortened(3).length, "three unusable frames re-armed nothing").toBeGreaterThan(0);
  }, 60_000);
});
