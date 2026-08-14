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
  /** SetSummary.durationMs as emitted — the engine's OWN span, which is what
   *  every reader of `watchedMs` clamps against. Kept separate from `spanMs`
   *  above on purpose: that one is computed here from the frames, so comparing
   *  the two fields of the summary is a different claim from comparing one
   *  field to the fixture. */
  readonly durationMs: number;
  /** SetSummary.watchedMs as emitted. Deliberately NOT defaulted to a number:
   *  `?? 0` here would make a field that stopped being emitted look like a set
   *  nobody watched, and every claim below would still pass. */
  readonly watchedMs: number | null | undefined;
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
    durationMs: summary.durationMs,
    watchedMs: summary.watchedMs,
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
    // absurd rep. `tempoMsAvg` is not rendered by any screen today (grepped
    // 2026-08-14: `apps/web` reads it nowhere) — it is STORED and SERVED, so a
    // wrong value here is a wrong number waiting for its first reader, and it
    // drives the billed rep time in `kcalPointForSetsV2` right now.
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

  // BOTH KINDS, and the occluded half is the point. §3.1's count of three is
  // enforced TWICE — once by `ingest.ts` on frames that do not arrive, once by
  // `fsm.ts` on frames that arrive carrying no usable metric — and only the
  // first was pinned. Measured 2026-08-14: loosening the FSM's own threshold
  // tenfold (`>= 3` to `>= 30`) left all 199 tests green, so the occluded path's
  // boundary was an unowned number. (T3 round 1 of this card, Low-1.)
  it.each(["blank", "occluded"] as const)(
    "ignores a blink — two unusable %s frames re-arm nothing, three do",
    (kind) => {
      // A gate lives in its tails and so must its test (:7298). Two frames is
      // below §3.1's count of three, so nothing may be re-armed: a short gap only
      // ADDS wall time, and no rep may come back SHORTER than it was clean.
      const frames = squatFrames();
      const clean = run(frames);
      const shortened = (gapFrames: number): { at: number; rep: number }[] => {
        const hits: { at: number; rep: number }[] = [];
        for (let at = 1; at < frames.length; at++) {
          const g = run(withLostSight(frames, at, gapFrames * FRAME_MS, kind));
          g.repDurations.forEach((d, i) => {
            if (d < (clean.repDurations[i] ?? Number.POSITIVE_INFINITY)) hits.push({ at, rep: i });
          });
        }
        return hits;
      };
      expect(shortened(2).slice(0, 5), `a two-frame ${kind} blink re-armed a rep's clock`).toEqual(
        [],
      );
      // …and the same sweep one frame longer MUST re-arm something, or the claim
      // above is satisfied by a fix that does nothing at all.
      expect(shortened(3).length, `three unusable ${kind} frames re-armed nothing`).toBeGreaterThan(
        0,
      );
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// THE CASE EVERY SWEEP ABOVE IS STRUCTURALLY BLIND TO — found by the T3 review
// of the fix itself (2026-08-14) and reproduced before a line was changed.
//
// Every test above runs on the two-rep clip, where ONE absence can interrupt at
// most ONE rep. So a rep watched end to end always survives to set the rate, and
// `session.ts`'s all-interrupted fallback is never evaluated: measured, no
// position in either sweep produces a `tempoMsAvg` of 0.
//
// A rep can be watched for LITERALLY NO TIME. The clock re-pins on the first
// usable frame (`fsm.ts`), and if the user returns already standing the rep
// completes on that SAME frame — `t - t`. Measured on this clip, truncated to
// one rep: reps 1, tempoMsAvg 0, against 3,400 ms clean. That zero is not a fast
// squat; it is a squat nobody timed, and `kcalPointForSetsV2` then bills the
// whole set as rest.
// ---------------------------------------------------------------------------

/** The frame index at which each rep completes on the clean clip. DERIVED, never
 *  pinned: a hard-coded index quietly stops meaning "rep N" the moment the clip
 *  or the definition changes, and the fixture would go vacuous without saying so. */
function repCompletionIndices(frames: readonly PoseFrame[]): readonly number[] {
  const session = squatSession();
  const at: number[] = [];
  let seen = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f === undefined) continue;
    const { repCount } = session.processFrame(f);
    if (repCount > seen) {
      seen = repCount;
      at.push(i);
    }
  }
  return at;
}

/** The same recording truncated the moment rep 1 completes — a ONE-rep set, so
 *  losing sight once is enough to leave no rep watched end to end. */
function oneRepFrames(): readonly PoseFrame[] {
  const frames = squatFrames();
  const at = repCompletionIndices(frames)[0];
  return frames.slice(0, (at ?? 0) + 1);
}

/** Two absences in one clip. The later is spliced FIRST so the earlier index
 *  still addresses the frame it named. */
function withTwoLostSights(
  frames: readonly PoseFrame[],
  firstAt: number,
  secondAt: number,
  gapMs: number,
  kind: Lost,
): readonly PoseFrame[] {
  return withLostSight(withLostSight(frames, secondAt, gapMs, kind), firstAt, gapMs, kind);
}

describe("a rep the camera never watched is not a measurement", () => {
  it("has a one-rep fixture that really does reach the unmeasured case", () => {
    // THE PRECONDITION, asserted rather than assumed. Both claims below are
    // worthless if the fixture stops producing a rep of zero watched duration,
    // and this is an FSM fact — unchanged by the session-level fix — so it pins
    // the fixture on the boundary from both sides of that fix (:7298).
    const oneRep = oneRepFrames();
    expect(run(oneRep).reps, "the truncated clip is no longer a one-rep set").toBe(1);
    const zeroWatched = [...Array(oneRep.length - 1).keys()]
      .map((i) => i + 1)
      .filter((at) => run(withLostSight(oneRep, at, ABSENCE_MS, "blank")).repDurations.includes(0));
    expect(zeroWatched.length, "no absence position leaves a rep with zero watched time").toBeGreaterThan(0);
  }, 60_000);

  it("never reports a set average of zero for a set that counted reps", () => {
    // THE CLAIM. "0 ms per rep" is not a slow reading or a fast one — it is
    // impossible, and the server reads it as "nobody exercised".
    const oneRep = oneRepFrames();
    const offenders: { kind: Lost; at: number; reps: number }[] = [];
    for (const kind of ["blank", "occluded"] as const) {
      for (let at = 1; at < oneRep.length; at++) {
        const g = run(withLostSight(oneRep, at, ABSENCE_MS, kind));
        if (g.reps > 0 && g.tempoMsAvg === 0) offenders.push({ kind, at, reps: g.reps });
      }
    }
    expect(
      offenders.slice(0, 5),
      `${String(offenders.length)} positions report a set average of 0 ms per rep`,
    ).toEqual([]);
  }, 60_000);

  it("reports NO rate at all when no rep was watched end to end", () => {
    // THE OTHER HALF, REWRITTEN FOR KD'S 2026-08-14 RULING. This test used to
    // assert the opposite — that the part-measured reps set the set's rate —
    // and that clause is now gone from `session.ts`. It was never a
    // measurement: it was a workaround for the server having no way to know how
    // long the camera watched, and it billed an all-interrupted set ~20% low
    // (:7487), which is the one place Kd's own part 2 was inverted.
    //
    // The number now exists (`watchedMs`, asserted below), so the honest answer
    // to "how long did one rep take" is that nobody knows, and the server
    // charges the watched time instead of a guess. Reporting null used to bill
    // LESS than the fallback — that was measured and it was true OF v2; it is
    // what made the fallback removable only once `kcalPointForSetsV3` existed
    // to read the watched time. Do not restore the fallback without also
    // undoing v3, or the set is billed twice at half a rate.
    //
    // Two absences, one inside each rep, so no rep is watched end to end — the
    // case the two-rep single-absence sweeps cannot construct.
    const frames = squatFrames();
    const completions = repCompletionIndices(frames);
    const repOneAt = completions[0] ?? 0;
    const repTwoAt = completions[1] ?? 0;
    // Absence 1 lands mid-descent of rep 1, so rep 1 keeps a REAL watched
    // remainder. Absence 2 lands on the frame rep 2 completes, so rep 2's
    // remainder is `t - t` — the unmeasured rep this test exists for.
    const g = run(withTwoLostSights(frames, Math.floor(repOneAt / 2), repTwoAt, ABSENCE_MS, "blank"));
    const zeros = g.repDurations.filter((d) => d === 0);
    const measured = g.repDurations.filter((d) => d > 0);
    // The fixture, asserted before the claim that rests on it. Without BOTH of
    // these the null below is satisfied by a set that counted no reps at all.
    expect(g.reps, "fixture no longer counts both reps").toBe(2);
    expect(zeros.length, "fixture no longer contains a zero-watched rep").toBeGreaterThan(0);
    expect(measured.length, "fixture no longer contains a part-measured rep").toBeGreaterThan(0);
    // THE CLAIM: no rep survived whole, so there is no rate to report.
    expect(g.tempoMsAvg, "a half-watched rep is setting the set's rate again").toBeNull();
    // AND the replacement is present and usable — a null rate with no watched
    // time would leave the server nothing to bill from, which is the failure
    // mode this pair exists to make impossible.
    expect(typeof g.watchedMs, "the set reports no watched time to bill from").toBe("number");
    expect(g.watchedMs, "watched time is not a positive measurement").toBeGreaterThan(0);
  }, 60_000);

  it("never bills more exercise than the camera watched, when sight is lost TWICE", () => {
    // THE HEADLINE PROMISE OF THIS WHOLE CARD, on the one path the fix added.
    //
    // Every other billing sweep in this file splices ONE absence into the
    // two-rep clip, and one absence always leaves a rep watched end to end — so
    // the all-interrupted fallback never runs and the promise was never checked
    // where the code is newest. The two tests above this one check what the
    // average EQUALS, which is a different claim: an average can be perfectly
    // well-formed and still bill more time than the camera ever saw. Found by
    // the diff-only re-review as its Low-2 (BACKLOG L16); it is round 1's own
    // finding — that the FIXTURE's shape was the hole — one level up.
    //
    // Same arithmetic the server actually charges (`reps × tempoMsAvg` at the
    // exercise MET, `kcalPointForSetsV2`), against the time the engine could
    // see: the span minus BOTH spliced absences.
    const frames = squatFrames();
    // Absence 1 mid-descent of rep 1, exactly as the test above places it, so
    // rep 1 keeps a real watched remainder. Absence 2 then walks every frame
    // after it, so the unmeasured rep arrives at many different points rather
    // than the single hand-picked one.
    const firstAt = Math.floor((repCompletionIndices(frames)[0] ?? 0) / 2);
    const offenders: { kind: Lost; secondAt: number; billedMs: number; watchedMs: number }[] = [];
    let unmeasured = 0;
    let ratelessRuns = 0;
    for (const kind of ["blank", "occluded"] as const) {
      for (let secondAt = firstAt + 1; secondAt < frames.length; secondAt++) {
        const g = run(withTwoLostSights(frames, firstAt, secondAt, ABSENCE_MS, kind));
        if (g.repDurations.includes(0)) unmeasured += 1;
        // The server's own arithmetic, mirrored: a rate when one was measured,
        // otherwise the watched time itself (`kcalPointForSetsV3`). The old
        // form of this line was `reps × (tempoMsAvg ?? 0)`, which since the
        // fallback's removal would score every all-interrupted position as
        // billing ZERO — the sweep would stay green by asserting nothing, the
        // exact vacuity this file has been burned by twice.
        if (g.reps > 0 && g.tempoMsAvg === null) ratelessRuns += 1;
        const engineWatchedMs = g.watchedMs ?? 0;
        const billedMs =
          g.reps > 0
            ? g.tempoMsAvg !== null
              ? Math.min(engineWatchedMs, g.reps * g.tempoMsAvg)
              : engineWatchedMs
            : 0;
        // The independent yardstick: the span the frames cover, minus the two
        // gaps spliced into them. Deliberately NOT the engine's own
        // `watchedMs` — a claim checked against itself is not a check.
        const watchedMs = g.spanMs - 2 * ABSENCE_MS;
        if (billedMs > watchedMs) offenders.push({ kind, secondAt, billedMs, watchedMs });
      }
    }
    // Non-vacuity, second axis: the branch this card ADDED must actually be
    // taken somewhere in the sweep, or the whole thing is a re-run of the v2
    // path under a new name.
    expect(ratelessRuns, "no sweep position reaches the rate-less branch").toBeGreaterThan(0);
    // The fixture, asserted before the claim that rests on it (:7298). A sweep
    // that never reaches an unmeasured rep would pass this test green while
    // proving nothing at all — which is precisely how the one-absence sweeps
    // missed the defect round 1 found.
    expect(unmeasured, "no two-absence position leaves a rep unmeasured").toBeGreaterThan(0);
    expect(
      offenders.slice(0, 5),
      `${String(offenders.length)} two-absence positions bill unwatched time as exercise ` +
        `(worst first five shown)`,
    ).toEqual([]);
  }, 60_000);
});

/** A PAUSE, which is not an absence. No frames arrive AT ALL — not blank ones,
 *  not unusable ones — and the timestamps inside the frames that resume have
 *  advanced by the pause length. Nothing in the clip tells the engine this
 *  happened; only the caller knows, which is the whole point of `loseSight()`.
 *
 *  @param told whether the caller says so. `false` reproduces the measured
 *  defect; `true` is the fix. */
function runWithPause(
  frames: readonly PoseFrame[],
  at: number,
  gapMs: number,
  told: boolean,
): Run {
  const session = squatSession();
  const events: RepEvent[] = [];
  session.onRep?.((e) => events.push(e));
  const shifted = [
    ...frames.slice(0, at),
    ...frames.slice(at).map((f) => ({ t: f.t + gapMs, kp: f.kp })),
  ];
  shifted.forEach((f, i) => {
    if (i === at && told) session.loseSight();
    session.processFrame(f);
  });
  const summary = session.end();
  const first = shifted[0];
  const last = shifted[shifted.length - 1];
  return {
    reps: summary.reps,
    tempoMsAvg: summary.tempoMsAvg,
    repDurations: events.map((e) => e.durationMs),
    spanMs: first !== undefined && last !== undefined ? last.t - first.t : 0,
    durationMs: summary.durationMs,
    watchedMs: summary.watchedMs,
    events,
  };
}

describe("a PAUSE is not exercise either — but only the caller can say so", () => {
  it("REPRODUCES the defect: a pause nobody declares is billed as squatting", () => {
    // THE MEASUREMENT THIS FIX EXISTS FOR, kept as a test rather than as prose in
    // a commit message. It is not an assertion about desired behaviour — it pins
    // what the engine CANNOT know, so that the reason `loseSight()` is on the
    // interface stays visible when someone later wonders why the caller has to
    // do any work at all.
    const frames = squatFrames();
    const at = Math.floor(frames.length / 2);
    const g = runWithPause(frames, at, ABSENCE_MS, false);
    expect(g.watchedMs, "the engine somehow noticed a gap with no frames in it").toBe(g.spanMs);
    expect(
      g.watchedMs ?? 0,
      "a two-minute pause is no longer inside watched time — has the engine gained a clock?",
    ).toBeGreaterThan(ABSENCE_MS);
  }, 60_000);

  it("a declared pause costs nothing, wherever it falls", () => {
    // THE FIX. Same clip, same gap, same frames — the only difference is that the
    // caller says it stopped feeding. Swept, because a pause taken between reps
    // and a pause taken mid-descent are different states of the FSM and the first
    // draft of the between-reps test proved that difference is where the bugs are.
    const frames = squatFrames();
    const offenders: { at: number; watchedMs: number; ceiling: number }[] = [];
    for (let at = 1; at < frames.length; at++) {
      const g = runWithPause(frames, at, ABSENCE_MS, true);
      const ceiling = g.spanMs - ABSENCE_MS;
      if ((g.watchedMs ?? Number.NaN) > ceiling) {
        offenders.push({ at, watchedMs: g.watchedMs ?? Number.NaN, ceiling });
      }
    }
    expect(
      offenders.slice(0, 5),
      `${String(offenders.length)} pause positions are still billed as watched`,
    ).toEqual([]);
  }, 120_000);

  it("a declared pause does not move the rep COUNT", () => {
    // The same argument that made `loseSight()` safe for absences (:7404) has to
    // hold for the caller-driven route, and it is asserted rather than inherited:
    // state, both debounce counters, `reachedBottom` and the smoothing buffer are
    // all untouched, so every rep still completes.
    const frames = squatFrames();
    const clean = run(frames);
    const counts = new Set<number>();
    for (let at = 1; at < frames.length; at++) {
      counts.add(runWithPause(frames, at, ABSENCE_MS, true).reps);
    }
    expect([...counts], "a declared pause changed the rep count somewhere").toEqual([clean.reps]);
  }, 120_000);

  it("a declared pause never leaves a rep timed as longer than the set was watched", () => {
    // The headline promise, on the new path: the server's own arithmetic against
    // the time the frames actually cover, minus the gap.
    const frames = squatFrames();
    const offenders: { at: number; billedMs: number; watchedMs: number }[] = [];
    for (let at = 1; at < frames.length; at++) {
      const g = runWithPause(frames, at, ABSENCE_MS, true);
      const watched = g.watchedMs ?? 0;
      const billedMs =
        g.reps > 0 ? (g.tempoMsAvg !== null ? Math.min(watched, g.reps * g.tempoMsAvg) : watched) : 0;
      const realWatchedMs = g.spanMs - ABSENCE_MS;
      if (billedMs > realWatchedMs) offenders.push({ at, billedMs, watchedMs: realWatchedMs });
    }
    expect(
      offenders.slice(0, 5),
      `${String(offenders.length)} declared-pause positions bill unwatched time as exercise`,
    ).toEqual([]);
  }, 120_000);
});

describe("the set reports how long the camera watched", () => {
  /** Largest gap between consecutive frames in the untouched recording —
   *  DERIVED from the clip, never a number picked to make a test pass (R0.2).
   *  It is the slack the lower bound below needs: watched time is credited
   *  between frames, so the frame straddling a splice can cost at most one
   *  ordinary frame interval. */
  function maxFrameGapMs(frames: readonly PoseFrame[]): number {
    let max = 0;
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1];
      const cur = frames[i];
      if (prev !== undefined && cur !== undefined) max = Math.max(max, cur.t - prev.t);
    }
    return max;
  }

  it("watches the whole of a clip it never loses sight of", () => {
    // THE CONTROL, and the tighter half of the pair: with every frame usable,
    // watched time is the span EXACTLY. An implementation that under-counts
    // (say by skipping the first interval) still satisfies every upper bound
    // below, so the equality is where that would show.
    const clean = run(squatFrames());
    expect(clean.watchedMs, "the set no longer reports watched time at all").toBe(clean.spanMs);
  });

  it("never claims to have watched more of the set than the set lasted", () => {
    // THE COMMENT ON THE FIELD SAYS THIS IS "asserted rather than assumed",
    // AND UNTIL NOW NOTHING ASSERTED IT. Every sweep in this file compares
    // `watchedMs` to a span computed HERE from the fixture; none of them
    // compares the two FIELDS OF THE SUMMARY to each other, which is the
    // claim the server relies on and the claim the comment makes. A reader
    // that trusted the comment would find it true only by luck.
    //
    // Both fields come off one `end()`, over every shape this file can build:
    // the untouched clip, an absence of either kind at every frame boundary,
    // and a pause both declared and not. The bound is `<=`, not `===`, because
    // an absence is meant to be excluded — this is the ceiling, and the two
    // sweeps below own the floor.
    const frames = squatFrames();
    const over: { shape: string; watchedMs: number | null | undefined; durationMs: number }[] = [];
    const check = (shape: string, g: Run): void => {
      const watched = g.watchedMs;
      if (watched === null || watched === undefined || watched > g.durationMs) {
        over.push({ shape, watchedMs: watched, durationMs: g.durationMs });
      }
    };
    check("untouched", run(frames));
    for (let at = 1; at < frames.length; at++) {
      for (const kind of ["blank", "occluded"] as const) {
        check(`${kind} absence at ${String(at)}`, run(withLostSight(frames, at, ABSENCE_MS, kind)));
      }
      for (const told of [true, false] as const) {
        check(
          `pause at ${String(at)}, ${told ? "declared" : "undeclared"}`,
          runWithPause(frames, at, ABSENCE_MS, told),
        );
      }
    }
    expect(
      over.slice(0, 5),
      `${String(over.length)} shapes report watching more of the set than the set lasted`,
    ).toEqual([]);
  }, 300_000);

  it("excludes the absence, and excludes only the absence, wherever it falls", () => {
    // THE CLAIM, swept over every frame boundary. Two bounds, and both are
    // load-bearing in opposite directions:
    //   · upper — the gap must be fully out, or the server bills a stretch
    //     nobody watched (the whole point of the field);
    //   · lower — no MORE than the gap may be out, or a set is billed short
    //     and the fix trades Kd's over-count for a new under-count, which is
    //     exactly the trap his part 2 was written to avoid.
    const frames = squatFrames();
    const slack = maxFrameGapMs(frames);
    const tooMuch: { at: number; watchedMs: number; ceiling: number }[] = [];
    const tooLittle: { at: number; watchedMs: number; floor: number }[] = [];
    for (let at = 1; at < frames.length; at++) {
      const g = run(withAbsence(frames, at, ABSENCE_MS));
      const watched = g.watchedMs ?? Number.NaN;
      const ceiling = g.spanMs - ABSENCE_MS;
      const floor = ceiling - slack;
      if (!(watched <= ceiling)) tooMuch.push({ at, watchedMs: watched, ceiling });
      if (!(watched >= floor)) tooLittle.push({ at, watchedMs: watched, floor });
    }
    expect(
      tooMuch.slice(0, 5),
      `${String(tooMuch.length)} absence positions report watching time nobody watched`,
    ).toEqual([]);
    expect(
      tooLittle.slice(0, 5),
      `${String(tooLittle.length)} absence positions throw away time that WAS watched`,
    ).toEqual([]);
  }, 60_000);

  it("excludes an absence taken BETWEEN reps, with no rep in progress", () => {
    // THE POSITION EVERY OTHER SWEEP IN THIS FILE UNDER-WEIGHTS, and the one
    // that decides whether watched time may be keyed to the rep clock's
    // re-arm flag. It may not: `loseSight()` returns early when no cycle is
    // open, so a user who steps away while STANDING between reps re-arms
    // nothing — and an implementation reading that flag would count the whole
    // absence as watched and bill it.
    const frames = squatFrames();
    const clean = run(frames);
    // THE POSITIONS ARE FOUND, NOT ASSUMED. A hand-picked index was tried first
    // and index 1 is already inside a cycle on this clip — the recording opens
    // below `upAt`, so the "obvious" answer tested the wrong line and said so.
    //
    // The discriminator is exact rather than approximate: `loseSight()` sets
    // `cycleInterrupted` AFTER its early return, so a rep whose cycle was open
    // is dropped from the average. An unchanged `tempoMsAvg` AND unchanged rep
    // durations therefore mean no cycle was open at the moment sight was lost —
    // which is the only state in which the early return is taken.
    // BOTH KINDS, and the second one is the whole reason this test survives.
    // The first draft swept only blank frames and the mutant that moves the
    // flag came back ALIVE — because on the blank path the SESSION marks
    // blindness itself and never consults the FSM at all. The occluded path is
    // the one that reads `fsm.sightLost`, so it is the only place the ordering
    // is observable. The fixture's shape was the hole again (:7487), one card on.
    const between: { kind: Lost; at: number }[] = [];
    for (const kind of ["blank", "occluded"] as const) {
      for (let at = 1; at < frames.length; at++) {
        const g = run(withLostSight(frames, at, ABSENCE_MS, kind));
        if (
          g.tempoMsAvg === clean.tempoMsAvg &&
          g.repDurations.length === clean.repDurations.length &&
          g.repDurations.every((d, i) => d === clean.repDurations[i])
        ) {
          between.push({ kind, at });
        }
      }
    }
    for (const kind of ["blank", "occluded"] as const) {
      expect(
        between.filter((b) => b.kind === kind).length,
        `no ${kind} position leaves every rep untouched — this clip cannot test the between-reps case`,
      ).toBeGreaterThan(0);
    }
    const counted = between
      .map(({ kind, at }) => ({ kind, at, g: run(withLostSight(frames, at, ABSENCE_MS, kind)) }))
      .filter(({ g }) => (g.watchedMs ?? Number.NaN) > g.spanMs - ABSENCE_MS)
      .map(({ kind, at, g }) => ({ kind, at, watchedMs: g.watchedMs, ceiling: g.spanMs - ABSENCE_MS }));
    expect(
      counted.slice(0, 5),
      `${String(counted.length)} of ${String(between.length)} between-reps absences are counted as watched`,
    ).toEqual([]);
  }, 180_000);

  it("counts a blink as watched, exactly as the rep clock does", () => {
    // The two must AGREE. §3.1 needs three unusable frames before sight is
    // lost, so one or two are not an absence: the rep clock runs through them
    // and so must watched time. Were they excluded here but not there, a set
    // could bill more rep time than it claims to have watched — the one
    // contradiction the field exists to make impossible.
    const frames = squatFrames();
    const clean = run(frames);
    const blink = run(withAbsence(frames, Math.floor(frames.length / 2), 2 * FRAME_MS));
    expect(blink.repDurations, "a two-frame blink re-armed the rep clock").toEqual(
      clean.repDurations,
    );
    expect(blink.watchedMs, "a two-frame blink was cut out of watched time").toBe(blink.spanMs);
  }, 60_000);
});
