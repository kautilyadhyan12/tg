// A run's words and Auto-pause (ROADMAP Stage 5 item 37a). Auto-pause is a rule that thresholds, so
// every kind of moment is in the table below: a light, a stumble, a slow walk, a start again, two
// steps and a stop, a wandering signal, a phone that gives no speed.
import { describe, expect, it } from "vitest";
import { AUTO_START, nextAutoPause, type AutoPauseChange, type Fix } from "../src/screens/running/autoPause";
import { clock, distance, leftOutLine, pace, runName, runWhen, splitLabel } from "../src/screens/running/runWords";

describe("a run's words", () => {
  it("are the clock, the distance and the pace in the person's own units", () => {
    expect([clock(0), clock(59), clock(767), clock(3725)]).toEqual(["0:00", "0:59", "12:47", "1:02:05"]);
    expect([distance(5120, "metric"), distance(5129, "metric"), distance(5120, "imperial")]).toEqual(["5.12", "5.12", "3.18"]);
    expect([pace(1720, 5120, "metric"), pace(1720, 5120, "imperial"), pace(0, 0, "metric"), pace(5000, 10, "metric")]).toEqual(["5:36", "9:01", "–:–", "–:–"]);
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

/** One point a second from `fromS`, going north at each of `speeds`, with the phone's own speed or none. */
function points(fromS: number, speeds: readonly number[], opts: { phoneSpeed?: boolean; accuracyM?: number; startLat?: number } = {}): Fix[] {
  let lat = opts.startLat ?? 26.1445;
  return speeds.map((v, i) => {
    lat += v / 111_132;
    return { at: (fromS + i) * 1000, lat, lng: 91.7362, accuracyM: opts.accuracyM ?? 5, speed: opts.phoneSpeed === false ? null : v };
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

const run = (n: number) => Array.from({ length: n }, () => 3);
const still = (n: number) => Array.from({ length: n }, () => 0);

describe("Auto-pause", () => {
  it.each<[string, Fix[], AutoPauseChange[]]>([
    ["stopping at a light pauses from the moment of stopping", points(0, [...run(10), ...still(10)]), [{ kind: "pause", at: 10_000 }]],
    ["a stumble of three seconds does not pause", points(0, [...run(10), ...still(3), ...run(10)]), []],
    ["a slow walk at 1 m a second never pauses", points(0, [...run(10), ...Array.from({ length: 60 }, () => 1)]), []],
    ["running again starts the clock from the first step", points(0, [...run(10), ...still(10), ...run(5)]), [{ kind: "pause", at: 10_000 }, { kind: "resume", at: 20_000 }]],
    ["two steps and a stop stay paused", points(0, [...run(10), ...still(10), 3, 3, ...still(5)]), [{ kind: "pause", at: 10_000 }]],
    ["with no speed from the phone, the distance between points counts", points(0, [...run(10), ...still(10), ...run(5)], { phoneSpeed: false }), [{ kind: "pause", at: 10_000 }, { kind: "resume", at: 20_000 }]],
  ])("%s", (_, fixes, expected) => {
    expect(changes(fixes)).toEqual(expected);
  });

  it("a signal wandering under trees, as fast as a walk, never starts the clock", () => {
    // Paused, the phone lying still: each point lands up to 25 m from the last, the phone sure only to 30 m.
    const wander: Fix[] = Array.from({ length: 30 }, (_, i) => ({
      at: i * 1000,
      lat: 26.1445 + (i % 2 === 0 ? 0.0002 : -0.0002),
      lng: 91.7362,
      accuracyM: 30,
      speed: null,
    }));
    expect(changes(wander, true)).toEqual([]);
  });

  it("a phone that says its speed is unknown (-1) is read by the distance instead", () => {
    const fixes = points(0, [...run(10), ...still(10)]).map((f) => ({ ...f, speed: -1 }));
    expect(changes(fixes)).toEqual([{ kind: "pause", at: 10_000 }]);
  });
});
