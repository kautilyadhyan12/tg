// The run plan's words on the phone (ROADMAP 37d-i): each NHS run said as the NHS's printable plan says
// it, each runner's run with its paces in the person's units, and by feel with no race time.
import { describe, expect, it } from "vitest";
import { c25kParts, pacesOf } from "@app/shared";
import * as words from "../src/screens/running/runPlanWords";

/** The words as read: the no-break spaces that keep "1 min" and "/km" whole read as spaces. */
const plain = <A extends unknown[]>(f: (...a: A) => string) => (...a: A): string => f(...a).replace(/\u00a0/g, " ").replace(/\u2060/g, "");
const minutes = plain(words.minutes);
const sessionDetail = plain(words.sessionDetail);
const sessionTitle = plain(words.sessionTitle);
const walkRunWords = plain(words.walkRunWords);
const { paceOf, planDistance } = words;

describe("Couch to 5K in words", () => {
  it.each([
    [0, "5 min warm-up walk, then alternate 1 min running and 1½ min walking (8 runs), then 5 min cool-down walk"],
    [3, "5 min warm-up walk, then alternate 1½ min running and 2 min walking (6 runs), then 5 min cool-down walk"],
    [6, "5 min warm-up walk, then run 1½ min, walk 1½ min, run 3 min, walk 3 min, run 1½ min, walk 1½ min, run 3 min, then 5 min cool-down walk"],
    [14, "5 min warm-up walk, then run 20 min, then 5 min cool-down walk"],
    [24, "5 min warm-up walk, then run 30 min, then 5 min cool-down walk"],
  ])("NHS run %i", (index, words) => {
    expect(walkRunWords(c25kParts(index))).toBe(words);
  });

  it("a run's title is its number and its whole time", () => {
    expect(sessionTitle({ kind: "walk_run", week: 1, run: 2, parts: c25kParts(1) }, "metric")).toBe("Run 2 · 28½ min");
    expect(minutes(30)).toBe("½ min");
    expect(minutes(2400)).toBe("40 min");
  });
});

describe("a runner's run in words", () => {
  const paces = pacesOf({ distanceM: 5000, timeS: 1500 });
  it("distances in the person's units, never rounded up", () => {
    expect(planDistance(5500, "metric")).toBe("5.5 km");
    expect(planDistance(7000, "metric")).toBe("7 km");
    expect(planDistance(8000, "imperial")).toBe("4.9 mi");
  });

  it("easy and long runs with their pace range, or by feel", () => {
    expect(sessionTitle({ kind: "long", m: 7000, reps: null }, "metric")).toBe("Long run · 7 km");
    expect(sessionDetail({ kind: "easy", m: 5500, reps: null }, paces, "metric")).toBe(`Easy pace, ${paceOf(paces?.easy[0] ?? 0, "metric")}–${paceOf(paces?.easy[1] ?? 0, "metric")} /km`);
    expect(sessionDetail({ kind: "easy", m: 5500, reps: null }, null, "metric")).toBe("Easy, conversational pace");
  });

  it("a faster run says its repeats, pace and rest; a mile's pace is a mile's", () => {
    const steady = { kind: "steady" as const, m: 6000, reps: { count: 2, m: 1000, restS: 60 } };
    expect(sessionDetail(steady, paces, "metric")).toBe(`Warm up, 2 × 1 km at tempo pace (${paceOf(paces?.steady[0] ?? 0, "metric")}–${paceOf(paces?.steady[1] ?? 0, "metric")} /km) with 1 min jog recovery, cool down`);
    expect(sessionDetail(steady, null, "metric")).toBe("Warm up, 2 × 1 km at tempo pace (comfortably hard) with 1 min jog recovery, cool down");
    expect(paceOf(300, "imperial")).toBe("8:03");
    expect(sessionDetail({ kind: "fast", m: 7000, reps: { count: 4, m: 800, restS: 180 } }, null, "imperial")).toBe("Warm up, 4 × 800 m at interval pace (hard but controlled) with 3 min jog recovery, cool down");
  });
});
