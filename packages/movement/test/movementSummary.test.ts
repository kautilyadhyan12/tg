// Each rep's score and the set's summary (ROADMAP 52b-ii-b; spec Part 2 §2.4). A score that thresholds a person's reps
// ships with a table over every class of case (CLAUDE.md §4): a mistake the camera could not see is never good form, and
// a rep in which it saw nothing has no score. Then the record's own clock, and real videos' summaries through the server's
// own check, the one the workout save uses.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engineSetSummarySchema, setSummarySchema } from "@app/shared";
import { MATCH_LIMITS, MovementMatcher, SetRecord, WATCHED_GAP, repScore, type FormStatus, type MatchFrame, type RepResult } from "../src/index.js";
import { runOf } from "../scripts/measureCheck.js";
import { proofVideos, readExercise, readMovement, withLeadIn } from "../scripts/movementCheck.js";

const SQUAT = readMovement("squat");
const EXERCISE = readExercise("squat", SQUAT);

const rep = (verdict: RepResult["verdict"], statuses: readonly FormStatus[], start = 0, end = 1000): RepResult => ({
  start,
  end,
  verdict,
  rule: null,
  reason: null,
  readings: {},
  standing: {},
  form: statuses.map((status, k) => ({ mistake: `m${String(k)}`, reading: status === "unseen" ? null : 1, status })),
  turn: 0.3,
  side: null,
});

describe("a rep's score: of the mistakes the camera could see, the share that were fine", () => {
  it.each([
    ["every mistake seen and fine", "counted", ["fine", "fine"], 100],
    ["one made, one fine", "counted", ["made", "fine"], 50],
    ["every mistake seen and made", "counted", ["made", "made"], 0],
    ["one fine, the other not seen: scored on what was seen", "counted", ["fine", "unseen"], 100],
    ["one made, the other not seen: the unseen one never lifts it", "counted", ["made", "unseen"], 0],
    ["one fine of three seen, one unseen", "counted", ["fine", "made", "made", "unseen"], 33],
    ["nothing seen: no score, never a good one", "counted", ["unseen", "unseen"], null],
    ["an exercise with no mistake the camera checks: no score", "counted", [], null],
    ["a rep not counted: no score", "short", [], null],
    ["a rep refused for its chest: no score", "refused", ["made"], null],
    ["another movement: no score", "other", [], null],
    ["unseen: no score", "unseen", [], null],
  ] as const)("%s", (_name, verdict, statuses, score) => {
    expect(repScore(rep(verdict, statuses))).toBe(score);
  });
});

/** A frame as the matcher returns it, at `t`, with a rep judged in it or none. */
const frame = (t: number, seen = true, judged: RepResult | null = null): MatchFrame => ({ t, state: "ready", count: 0, progress: null, rep: judged, seen, turned: null });

describe("the set's record", () => {
  const record = (): SetRecord => new SetRecord(EXERCISE, SQUAT, 2);

  it("its time runs from the first picture to the last; watched time only after a picture that saw the person", () => {
    const r = record();
    for (const [t, seen] of [[0, true], [100, true], [200, false], [300, false], [400, true], [500, true]] as const) r.add(frame(t, seen));
    expect([r.summary().durationMs, r.summary().watchedMs]).toEqual([500, 300]);
  });

  it(`a gap between pictures longer than ${String(WATCHED_GAP)} ms is watched for ${String(WATCHED_GAP)} ms at most (the matcher's own lost)`, () => {
    expect(WATCHED_GAP).toBe(MATCH_LIMITS.lost);
    const r = record();
    r.add(frame(0));
    r.add(frame(2000));
    expect([r.summary().durationMs, r.summary().watchedMs]).toEqual([2000, WATCHED_GAP]);
  });

  it("a picture at the same time as the last adds no time, and its rep is still kept (the matcher's finish)", () => {
    const r = record();
    r.add(frame(0));
    r.add(frame(100));
    r.add(frame(100, false, rep("counted", ["fine"])));
    expect(r.summary()).toMatchObject({ durationMs: 100, watchedMs: 100, reps: 1, repScores: [100] });
  });

  it("a clock that went back is a new set, as it is to the matcher: nothing of the old one is kept", () => {
    const r = record();
    r.add(frame(1000, true, rep("counted", ["made"])));
    r.add(frame(2000));
    r.add(frame(500));
    r.add(frame(600));
    expect(r.summary()).toMatchObject({ durationMs: 100, reps: 0, repScores: [] });
    expect(r.summary().faultCounts).toEqual({});
  });

  it("the reps' scores, faults and pace: a mistake counted in a counted rep and in a refused one, never in a rep only short", () => {
    const r = record();
    r.add(frame(0, true, rep("counted", ["fine", "unseen"], 0, 1200)));
    r.add(frame(1, true, rep("counted", ["made", "fine"], 2000, 3000)));
    r.add(frame(2, true, rep("short", [])));
    r.add(frame(3, true, rep("refused", ["made"])));
    r.add(frame(4, true, rep("counted", ["unseen", "unseen"], 5000, 5800)));
    const s = engineSetSummarySchema.parse(r.summary());
    expect(s).toMatchObject({ setIndex: 2, reps: 3, repScores: [100, 50], avgFormScore: 75, tempoMsAvg: 1000 });
    expect(s.faultCounts).toEqual({ m0: 2 });
  });

  it("is refused a set number under 1, or an exercise of another movement", () => {
    expect(() => new SetRecord(EXERCISE, SQUAT, 0)).toThrow(/set's number/);
    expect(() => new SetRecord({ ...EXERCISE, movement: "lunge" }, SQUAT, 1)).toThrow(/lunge/);
  });
});

describe("the camera file's version, which a saved set names, is raised whenever its numbers change", () => {
  it("both squat files, the camera file and its movement, are what version 1 was made from: change either and raise it here", () => {
    // Round one: the movement's numbers moved in this very job and nothing would have asked for the version to change.
    const text = (path: string): string => readFileSync(join(import.meta.dirname, "..", path), "utf8").replace(/\r\n/g, "\n");
    const made = createHash("sha256").update(text("exercises/squat.json")).update(text("movements/squat.json")).digest("hex");
    expect([EXERCISE.version, made]).toEqual([1, "09275ad83d9334076d8c4289381e66669123d49142cd850bc0df3801d7705e9d"]);
  });
});

describe("real videos' summaries, every frame the matcher returns, pass the server's own check", () => {
  const videos = proofVideos().filter((v) => ["squat_reference", "prisoner_squat_1", "fresh_deadlift_barbell_0"].includes(v.video.label));
  /** A video run as the phone will run it: every frame the matcher returns, and its finish, given to the set's record. */
  const recordOf = (v: (typeof videos)[number]) => {
    const { steady, measured } = runOf(withLeadIn(v.video));
    const matcher = new MovementMatcher(SQUAT, MATCH_LIMITS, EXERCISE);
    const record = new SetRecord(EXERCISE, SQUAT, 1);
    let count = 0;
    const times: number[] = [];
    steady.forEach((body, i) => {
      const m = measured[i];
      if (m === undefined) return;
      const f = matcher.next(body, m);
      count = f.count;
      times.push(f.t);
      record.add(f);
    });
    const last = matcher.finish();
    if (last !== null) {
      count = last.count;
      record.add(last);
    }
    return { record, count, first: times[0] ?? 0, end: times[times.length - 1] ?? 0 };
  };

  it.each(videos.map((v) => [v.video.label, v] as const))("%s", (_label, v) => {
    const { record, count, first, end } = recordOf(v);
    const s = setSummarySchema.parse(record.summary());
    if (s.mode === "log_only") throw new Error("an engine set");
    expect(s.reps).toBe(count);
    expect(s.reps).toBe(v.entry.movement === "squat" ? v.entry.reps : 0);
    // Good-form videos: every scored rep 100, and nothing made.
    expect(s.repScores.every((x) => x === 100)).toBe(true);
    expect(s.faultCounts).toEqual({});
    // The set's time is the stream's own, and the camera read the person nearly all of it.
    expect(s.durationMs).toBe(Math.round(end - first));
    expect(s.watchedMs ?? 0).toBeLessThanOrEqual(s.durationMs);
    expect(s.watchedMs ?? 0).toBeGreaterThan(0.9 * s.durationMs);
  });

  it("side on, every counted rep scored on the lean; facing the phone, on the knees", () => {
    const by = (label: string) => {
      const v = videos.find((x) => x.video.label === label);
      if (v === undefined) throw new Error(`no ${label}`);
      return recordOf(v).record.summary();
    };
    expect(by("squat_reference")).toMatchObject({ reps: 3, repScores: [100, 100, 100], view: "side" });
    expect(by("prisoner_squat_1")).toMatchObject({ view: "front" });
  });
});
