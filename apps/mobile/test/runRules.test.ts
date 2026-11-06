// A run's words and Auto-pause (ROADMAP Stage 5 item 37a). Auto-pause is a rule that thresholds, so
// every kind of moment is in the table below: a light, a stumble, a slow walk, a shuffle, a start
// again, one stride, a wandering signal, and Android's speed of 0 when it does not know one (Kd's
// walk of 2026-11-05 paused again and again on it). His walk itself, as the phone recorded it, is
// the last case.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTO_START, nextAutoPause, type AutoPauseChange, type Fix } from "../src/screens/running/autoPause";
import { fitPath, heading, unitMarks } from "../src/screens/running/routeShape";
import { clock, distance, leftOutLine, pace, runName, runWhen, splitLabel } from "../src/screens/running/runWords";

describe("a run's words", () => {
  it("are the clock, the distance and the pace in the person's own units", () => {
    expect([clock(0), clock(59), clock(767), clock(3725)]).toEqual(["0:00", "0:59", "12:47", "1:02:05"]);
    expect([distance(5120, "metric"), distance(5129, "metric"), distance(5120, "imperial")]).toEqual(["5.12", "5.12", "3.18"]);
    expect([pace(1720, 5120, "metric"), pace(1720, 5120, "imperial"), pace(0, 0, "metric"), pace(5000, 10, "metric")]).toEqual(["5:36", "9:01", "--:--", "--:--"]);
    expect([splitLabel(2, 1000, "metric"), splitLabel(5, 120, "metric"), splitLabel(0, 1609, "imperial")]).toEqual(["3", "0.12", "1"]);
    expect(leftOutLine(1840, "metric")).toBe("1.84 km isn't counted: it was faster than anyone has ever run.");
  });

  it("name a run by the hour it began", () => {
    const at = (h: number) => new Date(2026, 10, 4, h, 12);
    expect([4, 5, 11, 12, 16, 17, 20, 21].map((h) => runName(at(h)))).toEqual([
      "Night Run", "Morning Run", "Morning Run", "Afternoon Run", "Afternoon Run", "Evening Run", "Evening Run", "Night Run",
    ]);
    expect(runWhen(at(7))).toBe("Wed 4 Nov · 7:12 am");
    expect(runWhen(at(0))).toBe("Wed 4 Nov · 12:12 am");
  });
});

/** What the phone says of its speed: the true one, Android's 0 when it does not know, or nothing. */
type PhoneSpeed = "true" | "zero" | "none";

/** One point a second from `fromS`, going north at each of `speeds` metres a second. */
function points(fromS: number, speeds: readonly number[], phone: PhoneSpeed = "true", accuracyM = 5): Fix[] {
  let lat = 26.1445;
  return speeds.map((v, i) => {
    lat += v / 111_132;
    return { at: (fromS + i) * 1000, lat, lng: 91.7362, accuracyM, speed: phone === "true" ? v : phone === "zero" ? 0 : null };
  });
}

function changes(fixes: readonly Fix[], startPaused = false): AutoPauseChange[] {
  let state = { ...AUTO_START, paused: startPaused };
  const out: AutoPauseChange[] = [];
  for (const fix of fixes) {
    const next = nextAutoPause(state, fix);
    state = next.state;
    if (next.change !== null) out.push(next.change);
  }
  return out;
}

const at = (speed: number, n: number) => Array.from({ length: n }, () => speed);

describe("Auto-pause", () => {
  it.each<[string, Fix[], AutoPauseChange[]]>([
    ["stopping at a light pauses from the moment of stopping", points(0, [...at(3, 10), ...at(0, 12)]), [{ kind: "pause", at: 9000 }]],
    ["a stumble of three seconds does not pause", points(0, [...at(3, 10), ...at(0, 3), ...at(3, 10)]), []],
    ["a slow walk at 1 m a second never pauses", points(0, [...at(3, 10), ...at(1, 60)]), []],
    ["walking while Android says 0 for its speed never pauses", points(0, at(1.2, 120), "zero"), []],
    ["running while Android says 0 never pauses", points(0, at(3, 120), "zero"), []],
    ["a shuffle at 0.2 m a second is standing: it pauses", points(0, [...at(3, 10), ...at(0.2, 20)]), [{ kind: "pause", at: 9000 }]],
    ["running on starts the clock from the first step", points(0, [...at(3, 10), ...at(0, 10), ...at(3, 5)]), [{ kind: "pause", at: 9000 }, { kind: "resume", at: 20_000 }]],
    ["running on, Android saying 0, starts it once 5 m from the stop", points(0, [...at(3, 10), ...at(0, 10), ...at(3, 5)], "zero"), [{ kind: "pause", at: 9000 }, { kind: "resume", at: 21_000 }]],
    ["one stride and a stop stays paused", points(0, [...at(3, 10), ...at(0, 10), 3, ...at(0, 10)], "zero"), [{ kind: "pause", at: 9000 }]],
  ])("%s", (_, fixes, expected) => {
    expect(changes(fixes)).toEqual(expected);
  });

  it("a signal wandering under trees, as fast as a walk, never starts the clock or stops it", () => {
    // Each point lands up to 25 m from the last, the phone sure only to 30 m.
    const wander: Fix[] = Array.from({ length: 30 }, (_, i) => ({ at: i * 1000, lat: 26.1445 + (i % 2 === 0 ? 0.0002 : -0.0002), lng: 91.7362, accuracyM: 30, speed: null }));
    expect(changes(wander, true)).toEqual([]);
    expect(changes(wander, false)).toEqual([]);
  });

  it("Kd's walk inside his house: the six still minutes stay paused, without pausing again and again", () => {
    const walk = JSON.parse(readFileSync(new URL("./fixtures/indoor-walk.json", import.meta.url), "utf8")) as { points: [number, number, number, number][] };
    // The phone kept no speed: Android's 0, as it reported it on the walk.
    const seen = changes(walk.points.map(([t, lat, lng, acc]) => ({ at: t, lat, lng, accuracyM: acc, speed: 0 })));
    const pauses = seen.filter((c) => c?.kind === "pause");
    expect(pauses.length).toBeLessThanOrEqual(3);
    const last = seen[seen.length - 1];
    expect(last?.kind).toBe("pause");
    expect(last?.at ?? Infinity).toBeLessThan(4 * 60_000); // from before the still minutes began
    expect(seen[0]?.at ?? Infinity).toBeGreaterThan(8000); // never in the first eight seconds
  });
});

describe("a route laid flat", () => {
  const box = 300;
  const spanOf = (pts: [number, number][]) => Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));

  it("is true to its size: a 10 m wander is drawn small, a 2 km line fills the box", () => {
    const ten: [number, number][] = [[0, 0], [0, 10 / 111_320]];
    const two: [number, number][] = [[0, 0], [0, 2000 / 111_320]];
    expect(spanOf(fitPath(ten, box, box, 10))).toBeLessThan(20);
    expect(spanOf(fitPath(two, box, box, 10))).toBeCloseTo(280, 0);
  });

  it("puts a stone at each whole kilometre, never counting the gap across a pause", () => {
    // A degree of latitude at the equator is 110,574 m on the WGS84 ellipsoid.
    const north = (m: number): [number, number] => [m / 110_574, 0];
    // 1.5 km, a pause during which the person moved 3 km, then 0.6 km more: the second kilometre
    // ends 500 m into the stretch after the pause, where no point was kept.
    const track = [north(0), north(500), north(1000), north(1500), north(4500), north(5100)];
    const marks = unitMarks(track, [0, 4], "metric");
    expect(marks).toHaveLength(2);
    expect((marks[0]?.[0] ?? 0) * 110_574).toBeCloseTo(1000, 1);
    expect((marks[1]?.[0] ?? 0) * 110_574).toBeCloseTo(5000, 1);
  });
});

describe("the beam at the front of a run going on", () => {
  it("points the way the person is heading, and nowhere until they have moved", () => {
    // Screen points: x to the right (east), y down (south).
    expect(heading([[0, 0], [10, 0]], [0])).toBeCloseTo(0, 6); // east
    expect(heading([[0, 10], [0, 0]], [0])).toBeCloseTo(-Math.PI / 2, 6); // north, up the screen
    expect(heading([[0, 0], [2, 0]], [0])).toBeNull(); // two pixels: no way yet
    // After a pause the beam reads the new stretch alone, never the line across the gap.
    expect(heading([[0, 0], [50, 0], [50, 30], [50, 20]], [0, 2])).toBeCloseTo(-Math.PI / 2, 6);
  });
});
