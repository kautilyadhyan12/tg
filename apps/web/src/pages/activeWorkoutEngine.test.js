import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { CATALOG_58, setSummarySchema, slugForLegacyName } from "@app/shared";
import {
  accumulateSummary,
  averageFormScore,
  buildLogOnlySet,
  createSummaryLog,
  newWorkoutId,
  reconcileSets,
  recordHandCountedSet,
  setElapsedMs,
} from "./activeWorkoutEngine.js";

const summary = (over = {}) => ({
  exercise: "squat",
  setIndex: 1,
  reps: 2,
  repScores: [90, 80],
  ...over,
});

// Kd's smoke, 2026-08-07. The defect these pin: the set stopwatch was raw wall
// clock, so a pause inside a set was recorded as exercise — seven sets claiming
// 188 s across a 92 s session, printed as "3m 8s" over "2 min total" and billed
// at the full exercise rate. R9.5: each of these was shown RED against
// `nowMs - startedAtMs` before the fix landed.
describe("setElapsedMs — paused time is not exercise", () => {
  const T = 1_000_000; // an arbitrary epoch; only differences matter

  it("subtracts a pause that has ENDED", () => {
    // 100 s wall clock, 20 s of it paused → 80 s of set.
    expect(setElapsedMs({ startedAtMs: T, nowMs: T + 100_000, pausedMs: 20_000 })).toBe(80_000);
  });

  it("subtracts a pause that is STILL OPEN at capture", () => {
    // Paused 30 s ago and never resumed: the open pause counts too, or a set
    // ended from the paused screen banks all of it as work.
    expect(
      setElapsedMs({ startedAtMs: T, nowMs: T + 100_000, pauseStartedAtMs: T + 70_000 }),
    ).toBe(70_000);
  });

  it("subtracts BOTH a closed and an open pause", () => {
    expect(
      setElapsedMs({
        startedAtMs: T,
        nowMs: T + 100_000,
        pausedMs: 20_000,
        pauseStartedAtMs: T + 90_000,
      }),
    ).toBe(70_000); // 100 − 20 closed − 10 open
  });

  it("is unchanged from wall clock when nothing was paused", () => {
    expect(setElapsedMs({ startedAtMs: T, nowMs: T + 45_000 })).toBe(45_000);
  });

  it("never returns a negative duration, whatever the inputs claim", () => {
    // A clock that jumped, or a pause longer than the set — a negative here
    // would reach `buildLogOnlySet`, which floors at 0 and would hide it.
    expect(setElapsedMs({ startedAtMs: T, nowMs: T + 10_000, pausedMs: 999_000 })).toBe(0);
    expect(setElapsedMs({ startedAtMs: T + 50_000, nowMs: T })).toBe(0);
  });

  it("reports 0 — not a guess — when the set has no clock", () => {
    expect(setElapsedMs({ startedAtMs: null, nowMs: T })).toBe(0);
    expect(setElapsedMs({ startedAtMs: undefined, nowMs: T })).toBe(0);
  });

  it("ignores junk in the pause fields rather than propagating NaN", () => {
    // NaN would sail through `Math.max(0, NaN)` as NaN and land in the payload.
    expect(setElapsedMs({ startedAtMs: T, nowMs: T + 30_000, pausedMs: NaN })).toBe(30_000);
    expect(
      setElapsedMs({ startedAtMs: T, nowMs: T + 30_000, pauseStartedAtMs: NaN }),
    ).toBe(30_000);
  });
});

describe("accumulateSummary", () => {
  it("collects summaries in order and flattens rep scores across sets", () => {
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1 }));
    accumulateSummary(log, summary({ setIndex: 2, repScores: [70] }));
    expect(log.summaries.map((s) => s.setIndex)).toEqual([1, 2]);
    expect(log.repScores).toEqual([90, 80, 70]);
  });

  it("skips log-only sets (null summary, Part 6 §3.6)", () => {
    const log = createSummaryLog();
    accumulateSummary(log, null);
    expect(log.summaries).toEqual([]);
    expect(log.repScores).toEqual([]);
  });

  it("a zero-rep engine summary is recorded but contributes no scores", () => {
    const log = createSummaryLog();
    accumulateSummary(log, summary({ reps: 0, repScores: [] }));
    expect(log.summaries).toHaveLength(1);
    expect(log.repScores).toEqual([]);
  });

  it("clamps rep scores to 0–100", () => {
    const log = createSummaryLog();
    accumulateSummary(log, summary({ repScores: [104, -3, 88.6] }));
    expect(log.repScores).toEqual([100, 0, 89]);
  });
});

describe("averageFormScore", () => {
  it("averages every scored rep across sets, rounded", () => {
    // Distinct set ordinals, because that is what "across sets" means. This
    // fixture used to leave both at the default setIndex 1 — harmless while
    // accumulate blindly pushed, but two entries under one ordinal is the
    // duplicate the wire contract rejects, so the log now treats the second as
    // a replacement. The test was describing a workout that cannot exist.
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1, repScores: [90, 80] }));
    accumulateSummary(log, summary({ setIndex: 2, repScores: [70] }));
    expect(averageFormScore(log)).toBe(80);
  });

  it("a replaced set takes its rep scores with it", () => {
    // The other half of that change (T3 round 1, F4): splicing the summary but
    // leaving its scores behind would let a discarded set go on skewing the
    // workout average.
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1, repScores: [0, 0] }));
    accumulateSummary(log, summary({ setIndex: 1, repScores: [100] }));
    expect(log.summaries).toHaveLength(1);
    expect(log.repScores).toEqual([100]);
    expect(averageFormScore(log)).toBe(100);
  });

  it("is null when nothing was scored (UI shows —)", () => {
    expect(averageFormScore(createSummaryLog())).toBeNull();
  });

  it("stays null for a workout of hand-counted sets — reps are not a score", () => {
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged());
    expect(reconcileSets(log).summaries).toHaveLength(1);
    expect(averageFormScore(log)).toBeNull();
  });
});

const handLogged = (over = {}) => ({
  exerciseName: "Push-ups",
  setIndex: 1,
  reps: 12,
  durationMs: 44_000,
  ...over,
});

describe("buildLogOnlySet", () => {
  it("builds a set the shared wire contract accepts", () => {
    const result = buildLogOnlySet(handLogged());
    expect(result.kind).toBe("set");
    // Parsed against the REAL contract, not a copy of it: a set this function
    // builds but the server would reject is the failure worth catching.
    const parsed = setSummarySchema.parse(result.set);
    expect(parsed).toEqual(result.set);
    expect(result.set.exercise).toBe("push_up");
    expect(result.set.reps).toBe(12);
    expect(result.set.durationMs).toBe(44_000);
    expect(result.set.mode).toBe("log_only");
  });

  it("claims nothing about form — every scoring field is empty", () => {
    const { set } = buildLogOnlySet(handLogged());
    expect(set.avgFormScore).toBeNull();
    expect(set.repScores).toBeNull();
    expect(set.faultCounts).toEqual({});
    expect(set.engineVersion).toBeNull();
    expect(set.definitionVersion).toBeNull();
    expect(set.view).toBe("unknown");
  });

  it("drops a set nobody performed rather than sending 0 reps", () => {
    expect(buildLogOnlySet(handLogged({ reps: 0 })).kind).toBe("empty");
  });

  it("reports an exercise with no catalog row instead of inventing a slug", () => {
    const result = buildLogOnlySet(handLogged({ exerciseName: "Arnold Shoulder Press" }));
    expect(result).toEqual({
      kind: "unresolved-exercise",
      exerciseName: "Arnold Shoulder Press",
    });
  });

  it("never lowercases its way to a slug — the names are plural, the slugs singular", () => {
    // "Squats" → "squat". A mechanical rule gives "squats", which is not a row,
    // and a caller that shipped it would have its sets discarded server-side.
    expect(buildLogOnlySet(handLogged({ exerciseName: "Squats" })).set.exercise).toBe("squat");
    expect(slugForLegacyName("squats")).toBeNull();
  });

  it("treats a missing name as unresolved, not as a crash", () => {
    expect(buildLogOnlySet(handLogged({ exerciseName: undefined })).kind)
      .toBe("unresolved-exercise");
  });

  it("an EMPTY set of an uncatalogued exercise is just empty, not a veto", () => {
    // Reps are checked BEFORE the name, deliberately: a set nobody performed
    // must not stop the rest of a real workout from syncing just because the
    // exercise it was never done for has no catalog row. The ordering was
    // untested — reversing it left every test green. T3 round 2, F-4/N15.
    expect(buildLogOnlySet(handLogged({ exerciseName: "Arnold Shoulder Press", reps: 0 })))
      .toEqual({ kind: "empty" });
  });

  it("keeps a stray rep count inside the column's range", () => {
    // A value the smallint column rejects would fail the contract and park the
    // whole workout. Unreachable by tapping, pinned anyway. T3 round 2, F-4/N17.
    expect(buildLogOnlySet(handLogged({ reps: 40_000 })).set.reps).toBe(32_767);
    expect(buildLogOnlySet(handLogged({ reps: 2.6 })).set.reps).toBe(3);
  });

  it("keeps a stray clock reading inside the column's range", () => {
    // A clock that jumps backwards must not produce a negative duration, which
    // the contract rejects — that would park a real workout.
    expect(buildLogOnlySet(handLogged({ durationMs: -5000 })).set.durationMs).toBe(0);
    expect(buildLogOnlySet(handLogged({ durationMs: 1.6 })).set.durationMs).toBe(2);
    expect(buildLogOnlySet(handLogged({ durationMs: Number.NaN })).set.durationMs).toBe(0);
  });

  it("EVERY exercise in the REAL library builds a valid set — all 58", () => {
    // Read from `scripts/seed_exercises.py`, the library that actually feeds the
    // exercise picker — NOT from CATALOG_58.
    //
    // The first version of this test fed CATALOG_58's own names into
    // slugForLegacyName, whose lookup map is BUILT FROM CATALOG_58. It could not
    // fail for any table content, while its comment called it "the card's
    // central premise, asserted rather than believed" and syncClient.js cited it
    // as proof. A list checked against itself. T3 round 2, F-2.
    //
    // Reading the real file means a rename on either side fails here, loudly,
    // instead of silently stopping that exercise's workouts from ever syncing.
    const py = readFileSync(
      new URL("../../../../scripts/seed_exercises.py", import.meta.url),
      "utf8",
    );
    const libraryNames = [...py.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(libraryNames).toHaveLength(58); // the file is the source of the count too

    const failures = libraryNames.filter((name) => {
      const result = buildLogOnlySet(handLogged({ exerciseName: name }));
      return result.kind !== "set" || !setSummarySchema.safeParse(result.set).success;
    });
    expect(failures).toEqual([]);

    // And nothing in the table is unreachable from the library, which would mean
    // a catalog row no user can ever produce.
    const orphans = CATALOG_58.map((r) => r.legacyName).filter(
      (n) => !libraryNames.includes(n),
    );
    expect(orphans).toEqual([]);
  });
});

describe("recordHandCountedSet", () => {
  it("stores the set without deciding whether it reaches the wire", () => {
    const log = createSummaryLog();
    expect(recordHandCountedSet(log, handLogged()).kind).toBe("recorded");
    expect(log.handCounted.map((r) => r.setIndex)).toEqual([1]);
    expect(log.summaries).toEqual([]); // `summaries` is the ENGINE's list only
  });

  it("is idempotent per set ordinal — the four set-end paths overlap by design", () => {
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ reps: 12 }));
    const second = recordHandCountedSet(log, handLogged({ reps: 99 }));
    expect(second.kind).toBe("duplicate");
    expect(log.handCounted).toHaveLength(1);
    expect(log.handCounted[0].reps).toBe(12);
  });

  it("guards duplicates for an UNRESOLVABLE exercise too", () => {
    // The old guard read `summaries`, which an unresolved set never reached, so
    // the overlapping set-end paths recorded the name once each and the refusal
    // read "Arnold Shoulder Press, Arnold Shoulder Press" (T3 round 1, F3).
    // Now the guard reads the list it writes to, so no record can evade it.
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ exerciseName: "Arnold Shoulder Press" }));
    recordHandCountedSet(log, handLogged({ exerciseName: "Arnold Shoulder Press" }));
    expect(log.handCounted).toHaveLength(1);
    expect(reconcileSets(log).unresolved).toEqual(["Arnold Shoulder Press"]);
  });
});

describe("reconcileSets — who owns each set", () => {
  it("sends the hand-counted set when the engine filed nothing for it", () => {
    // THE F-3 REGRESSION, at the unit level. A definition existing is not the
    // engine having filed anything: fed zero frames it files nothing, and the
    // set used to be dropped by both sides.
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ setIndex: 1, reps: 5 }));
    const { summaries, unresolved } = reconcileSets(log);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].reps).toBe(5);
    expect(summaries[0].mode).toBe("log_only");
    expect(unresolved).toEqual([]);
  });

  it("the ENGINE wins a set both sides hold — never two entries for one ordinal", () => {
    // Two entries under one setIndex fail the contract's duplicate check and
    // park the whole workout. The engine's entry carries real measurement.
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ setIndex: 3, reps: 12 }));
    accumulateSummary(log, summary({ setIndex: 3, reps: 7 }));
    const { summaries } = reconcileSets(log);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].reps).toBe(7);
  });

  it("THE USER'S OWN COUNT WINS a set they were counting, even though the engine filed one", () => {
    // T3 F2. The engine used to win a shared ordinal unconditionally, and
    // `endSet()` returns a summary after ONE fed frame — reps possibly 0. So:
    // the camera is slow, the stall hands over at 5 s, the user taps 7, the
    // camera wakes and manages 2, and the set was stored as 2. The screen said
    // 7. This card created the path by recording the user's count on every set.
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ setIndex: 1, reps: 7, handOwned: true }));
    accumulateSummary(log, summary({ setIndex: 1, reps: 2, repScores: [88, 91] }));
    const { summaries } = reconcileSets(log);
    expect(summaries).toHaveLength(1);          // never two entries for one ordinal
    expect(summaries[0].reps).toBe(7);
    // Stored honestly: a set the camera stopped watching part-way cannot claim a
    // form score for reps nobody graded.
    expect(summaries[0].mode).toBe("log_only");
    expect(summaries[0].avgFormScore).toBeNull();
    expect(summaries[0].repScores).toBeNull();
  });

  it("an ORDINARY camera set keeps the engine's summary and its form score", () => {
    // The trap the `handOwned` flag exists to avoid, asserted directly. `reps`
    // on a hand record is WHAT THE SCREEN SHOWED, and in camera mode that is the
    // engine's own count — the page keeps one displayed number. So a reconcile
    // rule shaped like "any hand record wins" or "the bigger count wins" would
    // silently rewrite every graded set in the workout as log_only and throw its
    // form score away. handOwned is false here precisely because the user was
    // never counting, even though the record's reps are non-zero.
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ setIndex: 1, reps: 5, handOwned: false }));
    accumulateSummary(log, summary({ setIndex: 1, reps: 5, repScores: [90, 80] }));
    const { summaries } = reconcileSets(log);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].mode).toBeUndefined();  // the engine's own summary, untouched
    expect(summaries[0].repScores).toEqual([90, 80]);
  });

  it("DROPS the rep scores of a set it takes off the engine (round 4 F3)", () => {
    // The form average is computed from `repScores`, which is filled when a
    // summary is ACCUMULATED. Rule 1 removes that summary from the payload but
    // used to leave its grades in the list — so a set stored `log_only` with a
    // NULL score still contributed its scores to the workout average, and the
    // summary screen, dashboard and calendar showed a form score for a workout
    // the new API holds as entirely ungraded. `accumulateSummary` already
    // rebuilds this list when IT displaces an entry, for the same reason.
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1, reps: 2, repScores: [90, 86] }));
    expect(log.repScores).toEqual([90, 86]);          // accumulated, as before

    recordHandCountedSet(log, handLogged({ setIndex: 1, reps: 7, handOwned: true }));
    const { summaries, repScores } = reconcileSets(log);

    expect(summaries[0].mode).toBe("log_only");
    expect(repScores).toEqual([]);                     // nothing graded survives
    expect(averageFormScore({ repScores })).toBeNull();
  });

  it("KEEPS the rep scores of sets the engine still owns", () => {
    // The positive control: emptying the list unconditionally would be just as
    // wrong, and would silently strip the score off every ordinary workout.
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1, reps: 2, repScores: [90, 80] }));
    accumulateSummary(log, summary({ setIndex: 2, reps: 2, repScores: [70, 60] }));
    recordHandCountedSet(log, handLogged({ setIndex: 2, reps: 5, handOwned: true }));

    const { repScores } = reconcileSets(log);
    expect(repScores).toEqual([90, 80]);               // set 1 keeps its grades
    expect(averageFormScore({ repScores })).toBe(85);
  });

  it("mixes both sources in one workout, in set order", () => {
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 2, reps: 7 }));
    recordHandCountedSet(log, handLogged({ setIndex: 1, reps: 12 }));
    recordHandCountedSet(log, handLogged({ setIndex: 3, reps: 9 }));
    const { summaries } = reconcileSets(log);
    expect(summaries.map((s) => s.setIndex)).toEqual([1, 2, 3]);
    expect(summaries.map((s) => s.reps)).toEqual([12, 7, 9]);
  });

  it("names the unresolvable exercise so the caller can refuse the workout", () => {
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ exerciseName: "1 Leg Box Squat" }));
    const { summaries, unresolved } = reconcileSets(log);
    expect(summaries).toEqual([]);
    expect(unresolved).toEqual(["1 Leg Box Squat"]);
  });

  it("does NOT block the sync over an unresolvable set the engine already filed", () => {
    // The hand-counted record for a graded set is discarded before its name is
    // ever resolved. Reaching a refusal on a set that is not being sent would
    // park a workout for an exercise it does not contain.
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ setIndex: 1, exerciseName: "1 Leg Box Squat" }));
    accumulateSummary(log, summary({ setIndex: 1, reps: 7 }));
    const { summaries, unresolved } = reconcileSets(log);
    expect(unresolved).toEqual([]);
    expect(summaries).toHaveLength(1);
  });

  it("an empty set leaves the workout syncable — it is not a failure", () => {
    const log = createSummaryLog();
    recordHandCountedSet(log, handLogged({ reps: 0 }));
    const { summaries, unresolved } = reconcileSets(log);
    expect(summaries).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("does not mutate the log it reads", () => {
    // The page calls this at workout end, but nothing stops it being called
    // twice; a reconcile that appended to `summaries` would double every
    // hand-counted set on the second call.
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1 }));
    recordHandCountedSet(log, handLogged({ setIndex: 2 }));
    const first = reconcileSets(log);
    const second = reconcileSets(log);
    expect(first.summaries).toEqual(second.summaries);
    expect(log.summaries).toHaveLength(1);
  });
});

describe("newWorkoutId", () => {
  it("is a v4 UUID", () => {
    expect(newWorkoutId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("works where randomUUID does not — a plain-http origin has no secure context", () => {
    // The reason this function exists. A hand-counted workout never calls
    // getUserMedia, so the secure context the old bare `crypto.randomUUID()`
    // relied on is no longer guaranteed, and starting one would throw on
    // render. getRandomValues is not secure-context restricted.
    const real = globalThis.crypto;
    try {
      // stubGlobal, not assignment: `crypto` is a getter-only property here, so
      // a plain assignment throws and the test would be measuring that instead.
      vi.stubGlobal("crypto", { getRandomValues: (a) => real.getRandomValues(a) });
      expect(globalThis.crypto.randomUUID).toBeUndefined(); // the stub really took
      expect(newWorkoutId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives a different id each time — it is the sync idempotency key", () => {
    expect(newWorkoutId()).not.toBe(newWorkoutId());
  });
});
