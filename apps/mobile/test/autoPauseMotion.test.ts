// Auto-pause with the phone's motion (ROADMAP Stage 5 item 37j). A rule that decides when a person has
// stopped, so every class of case is here before review: a pram, a slow walker, a phone standing at every
// accuracy a phone reports, Start and stand, walking on under a weak signal, standing while using the phone,
// a treadmill, and the real recordings, which must be answered as before when the phone gives no motion.
// The standing phone's wander is the bug hunt's model (2026-11-20, A1): a first-order Gauss-Markov error,
// the usual model of GPS error, `sigma` metres typical error, forgetting itself over `tau` seconds, with a
// little jitter each second.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runSums, type RunPause, type RunPoint } from "@app/shared";
import { AUTO_START, autoPausedFrom, feelAt, nextAutoPause, type AutoPauseChange, type AutoPauseState, type Feel, type Fix } from "../src/screens/running/autoPause";
import { realRuns } from "./realRuns";

const LAT = 26.1445;
const LNG = 91.7362;
const NORTH = 111_132;
const EAST = 111_320 * Math.cos((LAT * Math.PI) / 180);

/** A seeded generator, so every number below is the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** Where a phone lying still says it is, metres east and north of the truth, one a second. */
function wander(seconds: number, sigma: number, tau: number, seed: number): [number, number][] {
  const r = rng(seed);
  const keep = Math.exp(-1 / tau);
  const push = sigma * Math.sqrt(1 - keep * keep);
  let x = sigma * gauss(r);
  let y = sigma * gauss(r);
  const out: [number, number][] = [];
  for (let i = 0; i < seconds; i++) {
    out.push([x + 0.3 * gauss(r), y + 0.3 * gauss(r)]);
    x = keep * x + push * gauss(r);
    y = keep * y + push * gauss(r);
  }
  return out;
}

/** One stretch of a walk: `seconds` points, one a second, going north at `speed`, the phone sure to
 *  `accuracyM` and feeling `feel`; its place off the truth by `off` (a wander) or by 0.3 m of jitter. */
interface Stretch {
  seconds: number;
  speed: number;
  accuracyM: number;
  feel: Feel | null;
  off?: [number, number][];
}

/** The points of the stretches, one after another from 1 s into the run, and the true metres walked. */
function walk(stretches: readonly Stretch[], seed = 1): { fixes: Fix[]; metres: number } {
  const r = rng(seed);
  const fixes: Fix[] = [];
  let north = 0;
  let s = 1;
  for (const part of stretches) {
    for (let i = 0; i < part.seconds; i++, s++) {
      north += part.speed;
      const [dx, dy] = part.off?.[i] ?? [0.3 * gauss(r), 0.3 * gauss(r)];
      fixes.push({ at: s * 1000, lat: LAT + (north + dy) / NORTH, lng: LNG + dx / EAST, accuracyM: part.accuracyM, speed: 0, feel: part.feel });
    }
  }
  return { fixes, metres: north };
}

function changesOf(fixes: readonly Fix[], start: AutoPauseState = AUTO_START): AutoPauseChange[] {
  let state = start;
  const out: AutoPauseChange[] = [];
  for (const fix of fixes) {
    const next = nextAutoPause(state, fix);
    state = next.state;
    if (next.change !== null) out.push(next.change);
  }
  return out;
}

/** The rule's state after the last point. */
function stateAfter(fixes: readonly Fix[], start: AutoPauseState = AUTO_START): AutoPauseState {
  let state = start;
  for (const fix of fixes) state = nextAutoPause(state, fix).state;
  return state;
}

/** The pauses the recorder keeps from those changes: a resume dated to its pause's start leaves none. */
function pausesOf(changes: readonly AutoPauseChange[], end: number): RunPause[] {
  const out: RunPause[] = [];
  let from: number | null = null;
  for (const c of changes) {
    if (c?.kind === "pause") from = c.at;
    else if (c?.kind === "resume" && from !== null) {
      if (c.at > from) out.push([from, c.at]);
      from = null;
    }
  }
  if (from !== null) out.push([from, end]);
  return out;
}

const pointsOf = (fixes: readonly Fix[]): RunPoint[] => fixes.map((f): RunPoint => [f.at, f.lat, f.lng, f.accuracyM]);
const endOf = (fixes: readonly Fix[]): number => fixes[fixes.length - 1]?.at ?? 0;
/** Metres the run counts with Auto-pause on, and with it off. */
function counted(fixes: readonly Fix[], changes: readonly AutoPauseChange[] = changesOf(fixes)): { on: number; off: number } {
  const end = endOf(fixes);
  return { on: runSums(pointsOf(fixes), pausesOf(changes, end), end, 70).distanceM, off: runSums(pointsOf(fixes), [], end, 70).distanceM };
}
const without = (fixes: readonly Fix[]): Fix[] => fixes.map((f) => ({ ...f, feel: null }));

describe("how a point feels", () => {
  // [ms into the run at the second's end, sd in hundredths of a m/s²]
  const motion: [number, number][] = [[1000, 4], [2000, 70], [3000, 71], [4000, 227], [5000, 228], [9000, 300]];
  it.each<[string, number, Feel | null]>([
    ["before the first second: not known", 999, null],
    ["the second ending at the point: still under 0.71 m/s²", 2000, "still"],
    ["0.71 itself: not known", 3000, null],
    ["2.27 itself: not known", 4000, null],
    ["over 2.27: moving", 5000, "moving"],
    ["the newest second before it, up to 3 s old", 8000, "moving"],
    ["a second older than 3 s: not known", 8001, null],
    ["after the last second, within 3 s", 12_000, "moving"],
  ])("%s", (_, at, feel) => {
    expect(feelAt(motion, at)).toBe(feel);
  });
  it("with no motion at all, never known", () => {
    expect(feelAt([], 5000)).toBeNull();
  });
});

describe("the worst thing: real metres thrown away because the phone felt still while the person moved", () => {
  // A phone in a pram or on a wheelchair feels still throughout while the GPS goes straight: 10 minutes with
  // two real stops of 30 s.
  it.each([
    [3, 5],
    [3, 15],
    [1, 5],
    [1, 15],
  ])("a pram at %s m a second, the phone sure to %s m, keeps every metre the run kept without the motion but 6; its two stops pause by place", (speed, accuracyM) => {
    const go = (seconds: number): Stretch => ({ seconds, speed, accuracyM, feel: "still" });
    const stop: Stretch = { seconds: 30, speed: 0, accuracyM, feel: "still" };
    const { fixes, metres } = walk([go(200), stop, go(170), stop, go(170)], speed * 100 + accuracyM);
    const changes = changesOf(fixes);
    const { on, off } = counted(fixes, changes);
    expect(off).toBeGreaterThan(speed * 500);
    expect(counted(without(fixes)).on - on).toBeLessThanOrEqual(6);
    // And against the metres truly walked: the two stops' own edges, as the rule without the motion loses them.
    expect(metres - on).toBeLessThanOrEqual(25);
    // One stop by feel at most before the phone is known to be on wheels, undone from when it left the stop's
    // own wander (a pram at 1 m a second sure to 15 m is near it for a few seconds); then only the real stops.
    const kept = pausesOf(changes, endOf(fixes));
    expect(changes.filter((c) => c?.kind === "pause").length).toBeLessThanOrEqual(3);
    const stops = kept.filter(([from]) => from >= 100_000);
    expect(stops).toHaveLength(2);
    const [first, second] = stops;
    expect(first?.[0]).toBeGreaterThanOrEqual(195_000);
    expect(first?.[1]).toBeLessThanOrEqual(240_000);
    expect(second?.[0]).toBeGreaterThanOrEqual(395_000);
    expect(second?.[1]).toBeLessThanOrEqual(440_000);
    const atStart = kept.filter(([from]) => from < 100_000);
    expect(atStart.reduce((t, [from, to]) => t + to - from, 0)).toBeLessThanOrEqual(8000);
  });

  // The re-check (H5): a real phone's place wanders on a pram as on a table. Pushed straight for 5 minutes, the
  // phone feeling still, the place wandering as the standing tests' does (half the accuracy, over 30 s).
  it.each([
    [1, 5],
    [1, 15],
    [1, 25],
    [2, 15],
    [2, 25],
    [3, 15],
    [3, 25],
  ])("a pram at %s m a second, its place wandering, sure to %s m: found on wheels every time, at most 60 m lost (50 tries)", (speed, accuracyM) => {
    let worst = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { fixes, metres } = walk([{ seconds: 300, speed, accuracyM, feel: "still", off: wander(300, accuracyM / 2, 30, seed * 7919 + accuracyM * 13 + speed) }]);
      expect(stateAfter(fixes).wheels).toBe(true);
      worst = Math.max(worst, metres - counted(fixes).on);
    }
    expect(worst).toBeLessThanOrEqual(60);
  });

  it("a pram left standing two minutes after Start, then pushed off, counts from when it left, not from Start", () => {
    const { fixes } = walk([
      { seconds: 120, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 300, speed: 1, accuracyM: 5, feel: "still" },
    ]);
    const changes = changesOf(fixes);
    expect(changes[0]).toEqual({ kind: "pause", at: 1000 });
    expect(changes[1]?.kind).toBe("resume");
    expect(changes[1]?.at ?? 0).toBeGreaterThanOrEqual(115_000);
    const { on, off } = counted(fixes, changes);
    expect(off - on).toBeLessThanOrEqual(6);
  });
});

describe("Auto-pause by the phone's motion", () => {
  it("Kd's phone on a table, its place sliding 11.5 m in 20 s with its own motion still: paused once, never taken for wheels", () => {
    // The brief's 10 m took this drift for a pram on Kd's phone: paused at 2.7 s, started again, never paused by feel again.
    const table = JSON.parse(readFileSync(new URL("./fixtures/table-drift.json", import.meta.url), "utf8")) as { points: [number, number, number, number][]; motion: [number, number][] };
    const fixes = table.points.map(([at, lat, lng, accuracyM]): Fix => ({ at, lat, lng, accuracyM, speed: 0, feel: feelAt(table.motion, at) }));
    expect(fixes.filter((f) => f.feel === "still").length).toBeGreaterThan(20);
    const changes = changesOf(fixes);
    expect(changes).toEqual([{ kind: "pause", at: 2657 }]);
  });

  it("a slow walker at 0.6 m a second, the phone feeling the steps, is never paused in 10 minutes", () => {
    for (const accuracyM of [5, 15, 25]) {
      const { fixes } = walk([{ seconds: 600, speed: 0.6, accuracyM, feel: "moving" }], accuracyM);
      expect(changesOf(fixes)).toEqual([]);
    }
  });

  // The phone stands still for 5 minutes, its place wandering as a real phone's does.
  const accuracies = [4, 8, 11, 15, 20, 25, 30];
  const standing = (accuracyM: number, seed: number) =>
    walk([{ seconds: 300, speed: 0, accuracyM, feel: "still", off: wander(300, accuracyM / 2, 30, seed * 7919 + accuracyM) }]).fixes;

  // 1,000 tries each: round one's review found 1 to 5 in 1,000 taken for wheels at 15 to 30 m, which 40 never met.
  it.each(accuracies)("a phone standing still, sure to %s m: paused within 6 s, never started again, at most 5 m counted (1,000 tries)", (accuracyM) => {
    for (let seed = 1; seed <= 1000; seed++) {
      const fixes = standing(accuracyM, seed);
      const changes = changesOf(fixes);
      expect(changes).toHaveLength(1);
      expect(changes[0]?.kind).toBe("pause");
      expect(changes[0]?.at ?? Infinity).toBeLessThanOrEqual(6000);
      expect(counted(fixes, changes).on).toBeLessThanOrEqual(5);
    }
  });

  it("Start and stand 40 s, then run: one pause from the first point, nothing counted in it, the run counted from its first step", () => {
    const { fixes } = walk([
      { seconds: 40, speed: 0, accuracyM: 8, feel: "still", off: wander(40, 4, 30, 11) },
      { seconds: 120, speed: 3, accuracyM: 8, feel: "moving" },
    ]);
    const changes = changesOf(fixes);
    expect(changes).toEqual([{ kind: "pause", at: 1000 }, { kind: "resume", at: 41_000 }]);
    const { on } = counted(fixes, changes);
    const run = runSums(pointsOf(fixes.filter((f) => f.at >= 41_000)), [], endOf(fixes), 70).distanceM;
    expect(Math.abs(on - run)).toBeLessThanOrEqual(3);
  });

  it("walking on under a weak signal after a stop: the clock starts within 12 s and 95 % of the walk is counted", () => {
    // The bug hunt's case (A4): today's rule held it paused for 5 minutes and counted 479 of 864 m.
    const { fixes } = walk([
      { seconds: 120, speed: 3, accuracyM: 5, feel: "moving" },
      { seconds: 30, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 300, speed: 1.4, accuracyM: 25, feel: "moving" },
      { seconds: 60, speed: 1.4, accuracyM: 6, feel: "moving" },
    ]);
    const changes = changesOf(fixes);
    expect(changes.map((c) => c?.kind)).toEqual(["pause", "resume"]);
    const walkFrom = 151_000;
    expect(changes[1]?.at ?? Infinity).toBeLessThanOrEqual(walkFrom + 12_000);
    const { on, off } = counted(fixes, changes);
    expect(off - on).toBeLessThanOrEqual(0.05 * 420);
    // And the same walk without the motion is today's answer.
    const before = counted(without(fixes));
    expect(before.off - before.on).toBeGreaterThan(300);
  });

  it("with no usable place at all, eight moving points in a row start the clock, at least 10 s after the stop", () => {
    const { fixes } = walk([
      { seconds: 60, speed: 3, accuracyM: 5, feel: "moving" },
      { seconds: 20, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 60, speed: 1.4, accuracyM: 45, feel: "moving" },
    ]);
    const changes = changesOf(fixes);
    expect(changes.map((c) => c?.kind)).toEqual(["pause", "resume"]);
    expect(changes[1]?.at).toBe(81_000);
  });

  /** Standing still 30 s, then the phone in the hand feeling moving for `seconds`: in how many of `tries` the
   *  clock starts again, and the most metres any try counts. */
  const inTheHand = (accuracyM: number, seconds: number, tries: number): { starts: number; mostM: number } => {
    let starts = 0;
    let mostM = 0;
    for (let seed = 1; seed <= tries; seed++) {
      const off = wander(30 + seconds, accuracyM / 2, 30, seed * 104_729 + accuracyM);
      const { fixes } = walk([
        { seconds: 30, speed: 0, accuracyM, feel: "still", off: off.slice(0, 30) },
        { seconds, speed: 0, accuracyM, feel: "moving", off: off.slice(30) },
      ]);
      const changes = changesOf(fixes);
      if (changes.some((c) => c?.kind === "resume")) starts += 1;
      mostM = Math.max(mostM, counted(fixes, changes).on);
    }
    return { starts, mostM };
  };

  it("standing still, then the phone in the hand feeling moving: how often the clock starts wrongly", () => {
    // The brief: under 1 in 20 at 5 m over 30 s. Round one (H3) found the old rule worse the longer it lasted
    // (260 in 1,000 over 2 minutes at 5 m). The rest are the numbers as measured, told to Kd in the handoff:
    // at 10 m and worse the place cannot tell 10 s of walking from a standing phone's drift.
    expect(inTheHand(5, 30, 400)).toEqual({ starts: 1, mostM: 5 });
    expect(inTheHand(5, 120, 400)).toEqual({ starts: 28, mostM: 11 });
    expect(inTheHand(10, 30, 400)).toEqual({ starts: 59, mostM: 19 });
    expect(inTheHand(15, 30, 400)).toEqual({ starts: 201, mostM: 53 });
  });

  // Round one (H1): a jump of the signal that stays where it landed is not a pram. A pram's distance from the stop
  // grows steadily; a jump is one step, then still.
  it.each([
    [45, 5],
    [60, 13],
    [80, 20],
  ])("a jump of the signal %s m away that stays a minute, the phone still and sure to %s m: the pause holds, never wheels", (jumpM, accuracyM) => {
    const r = rng(jumpM);
    const jumped = Array.from({ length: 60 }, (): [number, number] => [jumpM + 0.3 * gauss(r), 0.3 * gauss(r)]);
    const fixes = walk([
      { seconds: 30, speed: 0, accuracyM, feel: "still" },
      { seconds: 60, speed: 0, accuracyM, feel: "still", off: jumped },
      { seconds: 60, speed: 0, accuracyM, feel: "still" },
    ]).fixes;
    expect(changesOf(fixes)).toEqual([{ kind: "pause", at: 1000 }]);
    expect(stateAfter(fixes).wheels).toBe(false);
  });

  // Round one (H2): Kd's room walk read between the limits much of the time (37i). A still second in a walk, then
  // seconds the phone cannot read, must not date a later stop back across the walk.
  it.each([10, 20, 25, 60])("a still second in a walk, then %s s the phone cannot read, then a stop: the pause is the stop's own", (gap) => {
    const fixes = walk([
      { seconds: 30, speed: 1.4, accuracyM: 5, feel: "moving" },
      { seconds: 1, speed: 1.4, accuracyM: 5, feel: "still" },
      { seconds: gap, speed: 1.4, accuracyM: 5, feel: null },
      { seconds: 30, speed: 0, accuracyM: 5, feel: "still" },
    ]).fixes;
    const stopAt = (32 + gap) * 1000;
    const changes = changesOf(fixes);
    expect(changes.map((c) => c?.kind)).toEqual(["pause"]);
    expect(changes[0]?.at ?? 0).toBeGreaterThanOrEqual(stopAt - 1000);
    expect(counted(without(fixes)).on - counted(fixes, changes).on).toBeLessThanOrEqual(2);
    expect(stateAfter(fixes).wheels).toBe(false);
  });

  it("one moving point with a place, then two minutes of walking with none: eight moving points start the clock (round one, L1)", () => {
    const fixes = walk([
      { seconds: 60, speed: 3, accuracyM: 5, feel: "moving" },
      { seconds: 20, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 1, speed: 1.4, accuracyM: 25, feel: "moving" },
      { seconds: 120, speed: 1.4, accuracyM: 45, feel: "moving" },
    ]).fixes;
    expect(changesOf(fixes).map((c) => c?.kind)).toEqual(["pause", "resume"]);
  });

  it("a treadmill: the phone feels the running, its place still and sure: paused by place, never started by feel", () => {
    const { fixes } = walk([{ seconds: 600, speed: 0, accuracyM: 5, feel: "moving" }]);
    expect(changesOf(fixes)).toEqual([{ kind: "pause", at: 1000 }]);
  });

  it("a person's own pause, or one read back after the app was closed, is never started by feel before 10 s", () => {
    const { fixes } = walk([{ seconds: 30, speed: 1.4, accuracyM: 5, feel: "moving" }]);
    const from = fixes.map((f) => ({ ...f, at: f.at + 100_000 }));
    // Paused at 95 s: the first moving point is at 101 s, the clock may start from it once 105 s has passed.
    const changes = changesOf(from, autoPausedFrom(95_000));
    expect(changes).toEqual([{ kind: "resume", at: 101_000 }]);
  });
});

describe("with no motion, Auto-pause answers as it did before it", () => {
  // Today's rule's answers over the recordings, taken on 2026-11-25 before the motion was added (p = pause,
  // r = resume, at ms into the run).
  const before: Record<string, string[]> = {
    iphone: ["p60000", "r111000"],
    iphone4s: ["p0", "r14000", "p420000", "r444000", "p2747000", "r2778000"],
    runkeeper: [],
    hike: [
      "p633000", "r643000", "p714000", "r725000", "p799000", "r820000", "p854000", "r867000", "p909000", "r923000",
      "p944000", "r954000", "p1020000", "r1038000", "p1060000", "r1076000", "p1128000", "r1139000", "p1156000",
      "r1166000", "p1185000", "r1249000", "p1319000", "r1374000", "p1409000", "r1429000", "p1441000", "r1462000",
      "p1502000", "r1696000", "p1732000", "r1743000", "p1822000", "r1833000", "p1861000", "r1872000", "p1960000",
      "r1977000", "p1999000", "r2011000", "p2056000", "r2078000", "p2101000", "r2120000", "p2131000", "r2168000",
    ],
    indoor: ["p11793"],
  };
  const fixtures = (): [string, Fix[]][] => {
    const out: [string, Fix[]][] = [];
    for (const [name, points] of realRuns()) out.push([name, points.map(([at, lat, lng]) => ({ at, lat, lng, accuracyM: null, speed: null }))]);
    const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"));
    const hike = (read("real-hike.json") as { points: [number, number, number][] }).points;
    out.push(["hike", hike.map(([at, lat, lng]) => ({ at, lat, lng, accuracyM: null, speed: null }))]);
    const indoor = (read("indoor-walk.json") as { points: [number, number, number, number][] }).points;
    out.push(["indoor", indoor.map(([at, lat, lng, acc]) => ({ at, lat, lng, accuracyM: acc, speed: 0 }))]);
    return out;
  };

  it("over the three real runs, the hike and Kd's walk indoors: the same pauses at the same moments", () => {
    const seen = fixtures();
    expect(seen.map(([name]) => name).sort()).toEqual(Object.keys(before).sort());
    for (const [name, fixes] of seen) {
      const answers = changesOf(fixes.map((f) => ({ ...f, feel: null }))).map((c) => `${c?.kind === "pause" ? "p" : "r"}${String(c?.at)}`);
      expect([name, answers]).toEqual([name, before[name]]);
    }
  });

  it("a phone known to be on wheels is answered as one with no motion", () => {
    const [, hike] = fixtures().find(([name]) => name === "hike") ?? ["", []];
    let state: AutoPauseState = { ...AUTO_START, wheels: true };
    const answers: string[] = [];
    for (const f of hike) {
      const next = nextAutoPause(state, { ...f, feel: "still" });
      state = next.state;
      if (next.change !== null) answers.push(`${next.change.kind === "pause" ? "p" : "r"}${String(next.change.at)}`);
    }
    expect(answers).toEqual(before.hike);
  });
});
