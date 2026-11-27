import { WORKOUT_SAVE_LIMITS } from "@app/shared";
import { describe, expect, it } from "vitest";
import {
  FOLLOW_REP_MS,
  followLeftMs,
  followPress,
  followSecondsOf,
  followSounds,
  followedMs,
  repsOfTime,
  startFollow,
  targetAfterFollow,
  type Follow,
  type FollowPress,
} from "../src/camera/followAlong";
import { clipFor } from "../src/camera/voice";
import { READY_MS } from "../src/library/workoutRun";

// Follow along (ROADMAP Stage 5 53b-ii; RULINGS 2026-08-17): a timer runs the set while the person follows the exercise's clip.
// THE WORST THING: a number the app made up written as the person's reps. Nothing here reads the clip or the camera: the
// count the person is asked for starts from the time followed, by the same 3 s a rep the timer was made from, and moves
// only by their own presses.

const T0 = 1_800_000_000_000;

/** Presses in order, each at its own moment of the phone's clock. */
function run(f: Follow, steps: readonly (readonly [number, FollowPress])[]): Follow {
  return steps.reduce((s, [at, p]) => followPress(s, p, T0 + at), f);
}
const tick = { kind: "tick" } as const;

describe("the timer's length", () => {
  it.each([
    ["10 reps", "reps", 10, 30],
    ["7 reps", "reps", 7, 21],
    ["one rep, never under the shortest time a set takes (5 s)", "reps", 1, 5],
    ["the most reps a set saves, never over an hour", "reps", WORKOUT_SAVE_LIMITS.repsMost, Math.min(3600, (WORKOUT_SAVE_LIMITS.repsMost * FOLLOW_REP_MS) / 1000)],
    ["a hold of 20 s: its own time", "time", 20, 20],
    ["a hold of 90 s", "time", 90, 90],
  ] as const)("%s", (_, measuredIn, target, seconds) => {
    expect(followSecondsOf(measuredIn, target)).toBe(seconds);
    expect(startFollow(measuredIn, target, T0).seconds).toBe(seconds);
  });

  it("the person's count starts from the time followed, by the same 3 s a rep", () => {
    for (const [ms, reps] of [[0, 0], [1000, 0], [1500, 1], [6000, 2], [30_000, 10], [35_000, 12], [21_000, 7]] as const) expect(repsOfTime(ms)).toBe(reps);
    expect(repsOfTime(Number.MAX_SAFE_INTEGER)).toBe(WORKOUT_SAVE_LIMITS.repsMost);
  });
});

describe("the clock", () => {
  const start = startFollow("reps", 10, T0);

  it("10 s to get ready, then the set, ending by itself at its time", () => {
    expect(start.phase).toBe("ready");
    expect(followLeftMs(start)).toBe(READY_MS);
    const ready = run(start, [[9_999, tick]]);
    expect(ready.phase).toBe("ready");
    expect(followLeftMs(ready)).toBe(1);
    const set = run(start, [[10_000, tick]]);
    expect(set.phase).toBe("set");
    expect(followLeftMs(set)).toBe(30_000);
    expect(followedMs(set)).toBe(0);
    const half = run(start, [[25_000, tick]]);
    expect(followedMs(half)).toBe(15_000);
    const end = run(start, [[39_999, tick], [40_000, tick]]);
    expect(end).toMatchObject({ phase: "done", doneMs: 30_000, reps: 10 });
  });

  it("one reading after a long time away runs through the get-ready and the set, in order", () => {
    expect(run(start, [[3_600_000, tick]])).toMatchObject({ phase: "done", doneMs: 30_000, reps: 10 });
  });

  it("paused, the clock stands still; resumed, it goes on from where it stood", () => {
    const paused = run(start, [[12_000, { kind: "pause" }], [60_000, tick]]);
    expect(paused).toMatchObject({ phase: "set", paused: true });
    expect(followedMs(paused)).toBe(2_000);
    const resumed = run(paused, [[61_000, { kind: "resume" }], [64_000, tick]]);
    expect(followedMs(resumed)).toBe(5_000);
  });

  it("a phone clock set back moves nothing, and the clock goes on from the new time", () => {
    const back = run(start, [[12_000, tick], [2_000, tick]]);
    expect(followedMs(back)).toBe(2_000);
    expect(followedMs(run(back, [[5_000, tick]]))).toBe(5_000);
  });

  it("Start now skips the get-ready; Reset set gets ready again, its time kept", () => {
    const now = run(start, [[3_000, { kind: "start" }]]);
    expect(now.phase).toBe("set");
    expect(followLeftMs(now)).toBe(30_000);
    const longer = run(now, [[4_000, { kind: "time", by: 1 }], [20_000, { kind: "reset" }]]);
    expect(longer).toMatchObject({ phase: "ready", seconds: 35 });
    expect(followLeftMs(longer)).toBe(READY_MS);
  });

  it("the time changed while following: steps of 5 s, and shortened past what was followed it ends there", () => {
    const at = run(start, [[20_000, tick]]);
    expect(run(at, [[20_000, { kind: "time", by: 1 }]]).seconds).toBe(35);
    expect(run(at, [[20_000, { kind: "time", by: -1 }]]).seconds).toBe(25);
    // 10 s followed: 25, 20 and 15 s go on; 10 s ends the set at 10 s.
    const less = (n: number) => run(at, Array.from({ length: n }, () => [20_000, { kind: "time", by: -1 }] as const));
    expect(less(3)).toMatchObject({ phase: "set", seconds: 15 });
    expect(less(4)).toMatchObject({ phase: "done", seconds: 10, doneMs: 10_000, reps: 3 });
  });

  it("shortened past what was followed, it ends with the time followed, never the shorter one (round one, H1)", () => {
    // 27 s of 30 followed, made 25 s: the end says 27 s and starts the count at 9, not 25 s and 8.
    const at = run(start, [[1_000, { kind: "start" }], [28_000, tick]]);
    expect(followedMs(at)).toBe(27_000);
    expect(run(at, [[28_000, { kind: "time", by: -1 }]])).toMatchObject({ phase: "done", seconds: 25, doneMs: 27_000, reps: 9 });
    // A long hold whose step is 30 s: 350 s followed of 360, made 330 s, ends at 350 s.
    const hold = run(startFollow("time", 360, T0), [[1_000, { kind: "start" }], [351_000, tick], [351_000, { kind: "time", by: -1 }]]);
    expect(hold).toMatchObject({ phase: "done", seconds: 330, doneMs: 350_000 });
    // Getting ready, nothing is followed yet: a shorter time is only a shorter timer.
    expect(run(start, [[2_000, { kind: "time", by: -1 }]])).toMatchObject({ phase: "ready", seconds: 25 });
  });

  it("back to the camera: a hold's target is the time it was followed for, a set of reps keeps its reps (round one, L2)", () => {
    const hold = run(startFollow("time", 20, T0), [[1_000, { kind: "time", by: 1 }]]);
    expect(targetAfterFollow(hold, 20)).toBe(25);
    expect(targetAfterFollow(run(start, [[1_000, { kind: "time", by: 1 }]]), 10)).toBe(10);
  });

  it("Set done ends it with the time followed: nothing while getting ready", () => {
    expect(run(start, [[16_000, { kind: "done" }]])).toMatchObject({ phase: "done", doneMs: 6_000, reps: 2 });
    expect(run(start, [[4_000, { kind: "done" }]])).toMatchObject({ phase: "done", doneMs: 0, reps: 0 });
  });

  it("once ended nothing moves it but the person's own count, which stays within what a set saves", () => {
    const end = run(start, [[40_000, tick]]);
    const later = run(end, [[90_000, tick], [91_000, { kind: "time", by: 1 }], [92_000, { kind: "reset" }], [93_000, { kind: "pause" }], [94_000, { kind: "done" }]]);
    expect(later).toMatchObject({ phase: "done", doneMs: 30_000, reps: 10, seconds: 30, paused: false });
    expect(run(end, [[41_000, { kind: "reps", by: 1 }]]).reps).toBe(11);
    expect(run(end, [[41_000, { kind: "reps", by: -1 }]]).reps).toBe(9);
    const none = run(start, [[4_000, { kind: "done" }], [5_000, { kind: "reps", by: -1 }]]);
    expect(none.reps).toBe(0);
    const most = { ...end, reps: WORKOUT_SAVE_LIMITS.repsMost };
    expect(followPress(most, { kind: "reps", by: 1 }, T0 + 50_000).reps).toBe(WORKOUT_SAVE_LIMITS.repsMost);
    // Before the end a count is never asked, so it never moves.
    expect(run(start, [[15_000, { kind: "reps", by: 1 }]]).reps).toBe(0);
  });

  it("a hold followed for its own time asks no reps", () => {
    const hold = run(startFollow("time", 20, T0), [[30_000, tick]]);
    expect(hold).toMatchObject({ phase: "done", doneMs: 20_000, reps: 0 });
    expect(run(hold, [[31_000, { kind: "reps", by: 1 }]]).reps).toBe(0);
  });
});

describe("what it sounds", () => {
  const start = startFollow("reps", 10, T0);
  /** Every 250 ms reading of the clock from `from` to `to`, and what each sounds. */
  function heard(f: Follow, from: number, to: number): { at: number; beeps: readonly string[]; say: string | null }[] {
    const out: { at: number; beeps: readonly string[]; say: string | null }[] = [];
    let s = f;
    for (let at = from; at <= to; at += 250) {
      const next = followPress(s, tick, T0 + at);
      const h = followSounds(s, next, tick, T0 + at);
      if (h.beeps.length > 0 || h.say !== null) out.push({ at, ...h });
      s = next;
    }
    return out;
  }

  it("the last 3 s of the get-ready beep, the set starts with a rising go, Halfway at half, the last 3 s beep, Set complete at the end", () => {
    expect(heard(start, 0, 41_000)).toEqual([
      { at: 7_000, beeps: ["count"], say: null },
      { at: 8_000, beeps: ["count"], say: null },
      { at: 9_000, beeps: ["count"], say: null },
      { at: 10_000, beeps: ["go"], say: null },
      { at: 25_000, beeps: [], say: "halfway" },
      { at: 37_000, beeps: ["count"], say: null },
      { at: 38_000, beeps: ["count"], say: null },
      { at: 39_000, beeps: ["count"], say: null },
      { at: 40_000, beeps: [], say: "set complete" },
    ]);
  });

  it("no Halfway in a set under 20 s, as the coach says it only of a hold of 20 s or more", () => {
    const short = startFollow("reps", 5, T0);
    expect(heard(short, 0, 30_000).map((h) => h.say)).toEqual([null, null, null, null, null, null, null, "set complete"]);
    const twenty = startFollow("time", 20, T0);
    expect(heard(twenty, 0, 31_000).filter((h) => h.say === "halfway").map((h) => h.at)).toEqual([20_000]);
  });

  it("Halfway is said once a set: never again when the time is lengthened after it, again only after Reset set (round one, L1)", () => {
    const hold = startFollow("time", 20, T0);
    // Getting ready to 10 s; Halfway at 10 s of the set (20 s); at 12 s of the set (22 s) the time made 25 s, whose half
    // (12.5 s of the set) is then passed again; it ends at 35 s.
    const at = run(hold, [[12_000, tick]]);
    let s = at;
    const said: { at: number; say: string }[] = [];
    for (let t = 12_250; t <= 22_000; t += 250) {
      const p: FollowPress = t === 22_000 ? { kind: "time", by: 1 } : tick;
      const next = followPress(s, p, T0 + t);
      const h = followSounds(s, next, p, T0 + t);
      if (h.say !== null) said.push({ at: t, say: h.say });
      s = next;
    }
    for (let t = 22_250; t <= 40_000; t += 250) {
      const next = followPress(s, tick, T0 + t);
      const h = followSounds(s, next, tick, T0 + t);
      if (h.say !== null) said.push({ at: t, say: h.say });
      s = next;
    }
    expect(said).toEqual([{ at: 20_000, say: "halfway" }, { at: 35_000, say: "set complete" }]);
    // Reset set: a new set, said again at its own half.
    const again = run(run(start, [[30_000, tick]]), [[30_000, { kind: "reset" }]]);
    expect(again.halfway).toBe(false);
    expect(heard(again, 30_250, 56_000).filter((h) => h.say === "halfway").map((h) => h.at)).toEqual([55_000]);
  });

  it("shortened so that half is passed at once, Halfway is said on that press; passed while asleep, never", () => {
    const at = run(start, [[22_000, tick]]);
    // 12 s of 30 followed, made 20 s: half of it is 10 s.
    const shorter = followPress(followPress(at, { kind: "time", by: -1 }, T0 + 22_000), { kind: "time", by: -1 }, T0 + 22_000);
    const mid = followPress(at, { kind: "time", by: -1 }, T0 + 22_000);
    expect(followSounds(mid, shorter, { kind: "time", by: -1 }, T0 + 22_000)).toEqual({ beeps: [], say: "halfway" });
    // Away from 12 s to 20 s of a 30 s set: half was passed asleep, so Halfway is never said in this set.
    const late = followPress(at, tick, T0 + 30_000);
    expect(late.halfway).toBe(true);
    expect(followSounds(at, late, tick, T0 + 30_000)).toEqual({ beeps: [], say: null });
    expect(heard(late, 30_250, 41_000).map((h) => h.say)).toEqual([null, null, null, "set complete"]);
  });

  it("nothing while paused, for Pause and Resume, or for a reading that comes late (the app was asleep)", () => {
    const at = run(start, [[36_000, tick]]);
    const paused = followPress(at, { kind: "pause" }, T0 + 36_100);
    expect(followSounds(at, paused, { kind: "pause" }, T0 + 36_100)).toEqual({ beeps: [], say: null });
    expect(heard(paused, 36_250, 50_000)).toEqual([]);
    const resumed = followPress(paused, { kind: "resume" }, T0 + 50_000);
    expect(followSounds(paused, resumed, { kind: "resume" }, T0 + 50_000)).toEqual({ beeps: [], say: null });
    // Away 3 s, the reading crosses two beeps and the end: none of it is sounded.
    const late = followPress(at, tick, T0 + 39_500);
    expect(late.phase).toBe("set");
    expect(followSounds(at, late, tick, T0 + 39_500)).toEqual({ beeps: [], say: null });
  });

  it("Start now goes, Reset set says Get ready, Set done says Set complete, the person's count says nothing", () => {
    const now = followPress(start, { kind: "start" }, T0 + 1_000);
    expect(followSounds(start, now, { kind: "start" }, T0 + 1_000)).toEqual({ beeps: ["go"], say: null });
    const again = followPress(now, { kind: "reset" }, T0 + 5_000);
    expect(followSounds(now, again, { kind: "reset" }, T0 + 5_000)).toEqual({ beeps: [], say: "get ready" });
    const done = followPress(now, { kind: "done" }, T0 + 9_000);
    expect(followSounds(now, done, { kind: "done" }, T0 + 9_000)).toEqual({ beeps: [], say: "set complete" });
    const more = followPress(done, { kind: "reps", by: 1 }, T0 + 9_500);
    expect(followSounds(done, more, { kind: "reps", by: 1 }, T0 + 9_500)).toEqual({ beeps: [], say: null });
  });

  it("each line it says is one Kd recorded", () => {
    for (const when of ["get ready", "halfway", "set complete"] as const) expect(clipFor(when)).not.toBeNull();
    expect(clipFor("get ready")).toEqual({ id: "get_ready", index: 0 });
  });
});
