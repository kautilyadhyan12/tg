// The run's clock and its current pace, as the run's screen shows them (the running faults of
// 2026-11-20, A3 and A5). Testers on Google Play: "the timer gets stuck and keeps doing back and
// forth". The worst thing: the clock showing a time that is not the run's.
import { describe, expect, it } from "vitest";
import type { RunPoint } from "@app/shared";
import type { LiveRun } from "../src/screens/running/recorder";
import { closedStill, currentPace, liveStill, movingMsOf, pacing, sentOf, sumsAt } from "../src/screens/running/runLive";

const GO = 1_763_600_000_000;
const LAT = 26.1445;
const LNG = 91.7362;
// Metres a degree here, on the WGS 84 ellipsoid the app's distances are measured on.
const A = 6_378_137;
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
const RAD = Math.PI / 180;
const W = Math.sqrt(1 - E2 * Math.sin(LAT * RAD) ** 2);
const NORTH_PER_DEG = ((A * (1 - E2)) / W ** 3) * RAD;
const EAST_PER_DEG = (A / W) * Math.cos(LAT * RAD) * RAD;

/** A run going on, with these points and pauses. */
function liveRun(points: RunPoint[], pauses: [number, number | null][] = [], phase: LiveRun["phase"] = "running"): LiveRun {
  return {
    runId: "run", userId: "me", startedAt: GO, phase, pausedByPerson: false, autoPause: false, pauses, points,
    finishedMs: null, lastFix: null, here: null, guide: null, heart: [], motion: [], still: [], datedBack: [],
  };
}

/** One point a second, at each second's speed in m/s, with a standing phone's wander of 1 m. */
function pointsAt(speeds: readonly number[], accuracy: (i: number) => number | null = () => 5): RunPoint[] {
  const points: RunPoint[] = [];
  let north = 0;
  for (let i = 0; i <= speeds.length; i++) {
    if (i > 0) north += speeds[i - 1] ?? 0;
    const dx = Math.sin(i * 1.7) * Math.cos(i * 0.31);
    const dy = Math.cos(i * 2.3) * Math.sin(i * 0.53);
    points.push([i * 1000, LAT + (north + dy) / NORTH_PER_DEG, LNG + dx / EAST_PER_DEG, accuracy(i)]);
  }
  return points;
}

const steady = (seconds: number, mps: number): number[] => Array.from({ length: seconds }, () => mps);
/** The time shown, in whole seconds, as the screen's clock() shows it. */
const shown = (run: LiveRun, second: number): number => Math.floor(movingMsOf(run, GO + second * 1000) / 1000);

describe("the worst thing: the run's clock shows a time that is not the run's", () => {
  it("running, two minutes standing with no pause, running again: second by second it never goes down, and is the time since Go", () => {
    const all = pointsAt([...steady(300, 3), ...steady(120, 0), ...steady(120, 3)]);
    const clocks: number[] = [];
    for (let second = 1; second <= 540; second++) {
      clocks.push(shown(liveRun(all.filter((p) => p[0] <= second * 1000)), second));
    }
    const back = clocks.filter((c, k) => k > 0 && c < (clocks[k - 1] ?? 0)).length;
    expect(back).toBe(0);
    expect(clocks).toEqual(Array.from({ length: 540 }, (_, k) => k + 1));
  });

  it("one pause of 60 s: the clock holds through it, and after Resume it is the time since Go less the 60 s", () => {
    // The recorder keeps no points while paused.
    const all = pointsAt(steady(400, 3)).filter((p) => p[0] < 200_000 || p[0] >= 260_000);
    const clocks: number[] = [];
    for (let second = 1; second <= 400; second++) {
      const open = second < 260;
      const pauses: [number, number | null][] = second < 200 ? [] : [[200_000, open ? null : 260_000]];
      clocks.push(shown(liveRun(all.filter((p) => p[0] <= second * 1000), pauses, open && second >= 200 ? "paused" : "running"), second));
    }
    expect(clocks.filter((c, k) => k > 0 && c < (clocks[k - 1] ?? 0)).length).toBe(0);
    // Seconds 200 to 260: paused, and the clock holds at 3:20.
    expect(clocks.slice(199, 260).every((c) => c === 200)).toBe(true);
    expect(clocks.slice(260)).toEqual(Array.from({ length: 140 }, (_, k) => k + 261 - 60));
  });
});

describe("current pace", () => {
  /** A steady run of 3 m/s, 60 s of it, then the newest point changed. */
  const run3 = (change?: (p: RunPoint) => RunPoint): RunPoint[] => {
    // A steady line north, without the wander, so the pace is the speed.
    const line = Array.from({ length: 61 }, (_, i): RunPoint => [i * 1000, LAT + (i * 3) / NORTH_PER_DEG, LNG, 5]);
    const newest = line[line.length - 1];
    if (change !== undefined && newest !== undefined) line[line.length - 1] = change(newest);
    return line;
  };
  /** The newest point 80 m further on than the runner is, as a phone unsure of itself can give. */
  const off = (accuracy: number) => ([at, lat, lng]: RunPoint): RunPoint => [at, lat + 80 / NORTH_PER_DEG, lng, accuracy];

  it.each<[string, RunPoint[], boolean, "metric" | "imperial", string]>([
    ["steady 3 m/s, in kilometres", run3(), true, "metric", "5:33"],
    ["steady 3 m/s, in miles", run3(), true, "imperial", "8:56"],
    ["points with no accuracy are taken, as the distance takes them", run3().map(([a, b, c]): RunPoint => [a, b, c, null]), true, "metric", "5:33"],
    ["one point 80 m off that the phone was sure of only to 150 m is left out", run3(off(150)), true, "metric", "5:33"],
    ["one point 80 m off that the phone called sure to 8 m: faster than anybody runs, so no pace", run3(off(8)), true, "metric", "--:--"],
    ["under 5 s of points", run3().slice(0, 5), true, "metric", "--:--"],
    ["the newest sure point is 10 s old: no fresh signal", run3().map(([a, b, c, d], i): RunPoint => [a, b, c, i > 50 ? 40 : d]), true, "metric", "--:--"],
    ["the newest sure point is 8 s old: still a pace", run3().map(([a, b, c, d], i): RunPoint => [a, b, c, i > 52 ? 40 : d]), true, "metric", "5:33"],
    ["paused", run3(), false, "metric", "--:--"],
    ["no points yet", [], true, "metric", "--:--"],
    ["standing still: no pace", pointsAt(steady(60, 0)).map(([a, , , d]): RunPoint => [a, LAT, LNG, d]), true, "metric", "--:--"],
    // GPS_WORST_ACCURACY_M is 30: a point sure to exactly 30 m is taken, one sure to 30.5 m is not.
    ["one point 80 m off, sure to exactly 30 m, is taken: faster than anybody runs", run3(off(30)), true, "metric", "--:--"],
    ["one point 80 m off, sure to 30.5 m, is left out", run3(off(30.5)), true, "metric", "5:33"],
  ])("%s", (_case, points, running, units, want) => {
    // Now is the newest point's second, as when points come each second.
    expect(currentPace(points, running, units, 60_000)).toBe(want);
  });

  it("the signal lost altogether (a tunnel): no point comes, and over 8 s after the last one there is no pace, as the GPS light says Finding GPS", () => {
    expect(currentPace(run3(), true, "metric", 68_000)).toBe("5:33");
    expect(currentPace(run3(), true, "metric", 68_001)).toBe("--:--");
    expect(currentPace(run3(), true, "metric", 300_000)).toBe("--:--");
  });
});

describe("a phone that feels the person stand (37r)", () => {
  /** A run with one change made to it. */
  const runWith = (change: Partial<LiveRun>): LiveRun => ({ ...liveRun(pointsAt(steady(60, 3))), ...change });

  it.each<[string, Partial<LiveRun>, boolean]>([
    ["running, nothing felt", {}, true],
    ["running, a still stretch closed", { still: [[10_000, 20_000]] }, true],
    // The points go north at 3 m/s: from 50 s the phone has gone 30 m, within the 40 m the maths holds as a stand.
    ["running, Auto-pause off holding a still stretch open", { still: [[10_000, 20_000], [50_000, null]] }, false],
    ["running, the phone feeling still before Auto-pause has decided", { feltStillFrom: 55_000 }, false],
    // From 40 s it has gone 60 m: wheels the phone felt still, too fast for Auto-pause to find.
    ["running, a still stretch open while the phone went 60 m on", { still: [[40_000, null]] }, true],
    ["running, felt still while the phone went 60 m on", { feltStillFrom: 40_000 }, true],
    ["running, nothing felt (missing, as in a run read back)", { feltStillFrom: null }, true],
    ["paused", { phase: "paused" }, false],
    ["finished", { phase: "finished", finishedMs: 60_000 }, false],
  ])("Current pace %s: shown %s", (_case, change, shows) => {
    expect(pacing(runWith(change))).toBe(shows);
    // The screen passes it on: a pace of 3 m/s shows, and no pace at all where the phone feels the person stand.
    expect(currentPace(runWith(change).points, pacing(runWith(change)), "metric", 60_000) === "--:--").toBe(!shows);
  });

  it("the seconds felt still are standing on the screen from where they began: never inside a pause or a stretch kept, and gone once paused or finished", () => {
    expect(liveStill(runWith({ feltStillFrom: 40_000 }), 60_000)).toEqual([[40_000, 60_000]]);
    expect(liveStill(runWith({ feltStillFrom: 40_000, still: [[10_000, 45_000]] }), 60_000)).toEqual([[10_000, 45_000], [45_000, 60_000]]);
    expect(liveStill(runWith({ feltStillFrom: 40_000, pauses: [[30_000, 50_000]] }), 60_000)).toEqual([[50_000, 60_000]]);
    expect(liveStill(runWith({ feltStillFrom: 40_000, datedBack: [[35_000, 42_000]] }), 60_000)).toEqual([[35_000, 42_000], [42_000, 60_000]]);
    expect(liveStill(runWith({ feltStillFrom: 60_000 }), 60_000)).toEqual([]);
    expect(liveStill(runWith({ feltStillFrom: 40_000, phase: "paused" }), 60_000)).toEqual([]);
    expect(liveStill(runWith({ feltStillFrom: 40_000, phase: "finished", finishedMs: 60_000 }), 60_000)).toEqual([]);
    expect(liveStill(runWith({}), 60_000)).toEqual(closedStill(runWith({}), 60_000));
  });

  it("a walk the phone felt still for its last 10 s (30 m, inside the 40 m a still phone may go) shows none of those metres while it lasts, and they are never sent", () => {
    const felt = runWith({ feltStillFrom: 50_000 });
    expect(sumsAt(runWith({}), 60_000, 70).distanceM).toBeGreaterThanOrEqual(170);
    expect(sumsAt(felt, 60_000, 70).distanceM).toBeLessThanOrEqual(sumsAt(runWith({}), 60_000, 70).distanceM - 25);
    expect(sentOf({ ...felt, phase: "finished", finishedMs: 60_000 })).not.toHaveProperty("still");
    expect(sentOf({ ...felt, finishedMs: 60_000 })).not.toHaveProperty("still");
  });
});
