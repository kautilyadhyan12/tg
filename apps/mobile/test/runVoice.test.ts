// The run's voice (ROADMAP Stage 5 item 37a-ii). The worst thing: a runner told a wrong number out
// loud: a kilometre they have not run, kilometres to somebody on miles, or a time or pace that the
// summary does not show. So the first test is three real runs recorded on phones (not made here),
// fed a point at a time as the phone takes them, in kilometres and in miles: every line the voice
// says is the summary's own numbers for that mark, and every mark is said once.
import { describe, expect, it } from "vitest";
import { runSums, type RunPoint, type RunSums, type Units } from "@app/shared";
import { METRES_PER_MILE } from "../src/screens/running/runWords";
import {
  CHECK_MS,
  SETTLE_S,
  VOICE_AFTER_LOAD,
  VOICE_START,
  markLine,
  newMark,
  spokenTime,
  voiceCheck,
  type Mark,
  type VoiceState,
} from "../src/screens/running/runVoice";
import { realRuns, type RealPoint } from "./realRuns";

const RUNS = realRuns();
const REAL = [...RUNS.entries()];

/** A run's points as the phone keeps them: ms into the run (Go two seconds before the first fix). */
const asRun = (points: readonly RealPoint[]): RunPoint[] => points.map(([t, lat, lng]): RunPoint => [t + 2000, lat, lng, null]);

/** The voice through a whole run, a point at a time; how many times the maths was worked out. */
function speakThrough(points: readonly RunPoint[], units: Units, from: VoiceState = VOICE_START, first = 0) {
  let state = from;
  const lines: { at: number; line: string; mark: Mark }[] = [];
  let checks = 0;
  for (let i = first; i < points.length; i++) {
    const at = points[i]?.[0] ?? 0;
    const result = voiceCheck(state, at, units, () => {
      checks += 1;
      return runSums(points.slice(0, i + 1), [], at, 0);
    }, false);
    state = result.state;
    if (result.line !== null && result.mark !== null) lines.push({ at, line: result.line, mark: result.mark });
  }
  return { lines, checks };
}

/** The kilometre or mile's own time, as the summary shows it. */
function summaryLast(final: RunSums, units: Units, count: number): number {
  return (units === "imperial" ? final.splitsMi : final.splitsKm)[count - 1]?.s ?? -1;
}

/** The moving time at the last point before mark n and at the first point past it, each worked out
 *  from the points up to it alone: the time at the mark lies between them. */
function clockAroundMark(points: readonly RunPoint[], per: number, count: number): [number, number] {
  const sumsTo = (length: number) => runSums(points.slice(0, length), [], points[length - 1]?.[0] ?? 0, 0);
  let lo = 1;
  let hi = points.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sumsTo(mid).distanceM >= count * per) hi = mid;
    else lo = mid + 1;
  }
  return [sumsTo(lo - 1).movingS, sumsTo(lo).movingS];
}

describe("the worst thing: a wrong number said out loud", () => {
  it.each(REAL.flatMap(([key, run]) => (["metric", "imperial"] as const).map((units) => [key, units, run] as const)))(
    "%s in %s: each mark said once, with the summary's own numbers",
    (_key, units, run) => {
      const points = asRun(run);
      const end = points[points.length - 1]?.[0] ?? 0;
      const final = runSums(points, [], end, 0);
      const per = units === "imperial" ? METRES_PER_MILE : 1000;
      const { lines } = speakThrough(points, units);
      // Every mark passed, once each. The last is said only if it settled before the run ended: never
      // under SETTLE_S before the end, always past SETTLE_S and a check (the summary says it).
      const whole = Math.floor(final.distanceM / per);
      const sinceLast = (units === "imperial" ? final.splitsMi : final.splitsKm).slice(whole).reduce((t, split) => t + split.s, 0);
      const said = lines.map((l) => l.mark.count);
      const all = Array.from({ length: whole }, (_, i) => i + 1);
      if (sinceLast < SETTLE_S) expect(said).toEqual(all.slice(0, -1));
      else if (sinceLast >= SETTLE_S + CHECK_MS / 1000) expect(said).toEqual(all);
      else expect([all, all.slice(0, -1)]).toContainEqual(said);
      expect(said.length).toBeGreaterThan(3);
      const unit = units === "imperial" ? "mile" : "kilometre";
      for (const { line, mark } of lines) {
        const n = mark.count;
        expect(mark.units).toBe(units);
        // The kilometre or mile's own time is the summary's, to the second, and is what is said.
        if (n > 1) expect(line).toContain(`Last ${unit} ${spokenTime(summaryLast(final, units, n))}.`);
        // The time said lies between the clock at the points either side of the mark (a second for
        // rounding each way), and the average pace said is that time over the marks.
        const [before, after] = clockAroundMark(points, per, n);
        expect(mark.timeS).toBeGreaterThanOrEqual(before - 1);
        expect(mark.timeS).toBeLessThanOrEqual(after + 1);
        expect(line.startsWith(`${String(n)} ${unit}${n === 1 ? "" : "s"}. Time ${spokenTime(mark.timeS)}.`)).toBe(true);
        expect(line).toContain(`Average pace ${spokenTime(Math.round(mark.timeS / n))} per ${unit}.`);
      }
      // Never the other unit's word.
      for (const { line } of lines) expect(line).not.toMatch(units === "imperial" ? /kilometre/ : /mile/);
    },
  );

  it("a run reopened mid-way never says a mark already passed", () => {
    const points = asRun(RUNS.get("iphone") ?? []);
    // The app closed at 3.4 km: the voice starts again knowing nothing.
    const cut = points.findIndex((_, i) => runSums(points.slice(0, i + 1), [], points[i]?.[0] ?? 0, 0).distanceM >= 3400);
    const { lines } = speakThrough(points.slice(0, cut + 600), "metric", VOICE_AFTER_LOAD, cut);
    const later = speakThrough(points.slice(0, cut + 600), "metric").lines.filter((l) => l.at > (points[cut]?.[0] ?? 0));
    expect(lines.some((l) => l.line.startsWith("3 kilometres"))).toBe(false);
    expect(lines.map((l) => l.line)).toEqual(later.map((l) => l.line));
  });

  it("works the maths out a few times a kilometre, not at every point", () => {
    const points = asRun(RUNS.get("iphone") ?? []);
    const { checks } = speakThrough(points, "metric");
    const km = runSums(points, [], points[points.length - 1]?.[0] ?? 0, 0).distanceM / 1000;
    expect(checks / km).toBeLessThan(20);
  });
});

/** A run's numbers as the maths gives them, for the rule's own cases. */
function sums(distanceM: number, splitsKm: [number, number][], movingS: number, splitsMi: [number, number][] = []): RunSums {
  return {
    distanceM, elapsedS: movingS, movingS, stillS: 0, leftOutM: 0, leftOutS: 0, kcal: 0,
    splitsKm: splitsKm.map(([m, s]) => ({ m, s })), splitsMi: splitsMi.map(([m, s]) => ({ m, s })), track: [], trackStarts: [], bests: { k1: null, mile: null, k5: null, k10: null }, paceLine: [],
  };
}

describe("the voice's words", () => {
  it.each<[number, string]>([
    [0, "0 seconds"], [1, "1 second"], [59, "59 seconds"], [60, "1 minute"], [61, "1 minute 1 second"],
    [680, "11 minutes 20 seconds"], [3600, "1 hour"], [3661, "1 hour 1 minute 1 second"], [3725, "1 hour 2 minutes 5 seconds"], [7200, "2 hours"],
  ])("%i seconds are said %s", (seconds, said) => {
    expect(spokenTime(seconds)).toBe(said);
  });

  it.each<[string, Mark, string]>([
    ["the first kilometre has no last kilometre of its own", { count: 1, units: "metric", timeS: 340, lastS: 338 }, "1 kilometre. Time 5 minutes 40 seconds. Average pace 5 minutes 40 seconds per kilometre."],
    ["a later kilometre", { count: 2, units: "metric", timeS: 680, lastS: 340 }, "2 kilometres. Time 11 minutes 20 seconds. Last kilometre 5 minutes 40 seconds. Average pace 5 minutes 40 seconds per kilometre."],
    ["one mile", { count: 1, units: "imperial", timeS: 545, lastS: 545 }, "1 mile. Time 9 minutes 5 seconds. Average pace 9 minutes 5 seconds per mile."],
    ["three miles past an hour", { count: 3, units: "imperial", timeS: 3725, lastS: 1250 }, "3 miles. Time 1 hour 2 minutes 5 seconds. Last mile 20 minutes 50 seconds. Average pace 20 minutes 42 seconds per mile."],
    ["a pace slower than an hour a kilometre is not said", { count: 2, units: "metric", timeS: 7500, lastS: 3700 }, "2 kilometres. Time 2 hours 5 minutes."],
  ])("%s", (_name, mark, said) => {
    expect(markLine(mark)).toBe(said);
  });
});

describe("when the voice speaks", () => {
  it.each<[string, RunSums, number, boolean, Mark | null]>([
    ["not before the first kilometre", sums(990, [[990, 330]], 332), 0, false, null],
    ["not in the first SETTLE_S seconds past a mark", sums(1040, [[1000, 330], [40, SETTLE_S - 1]], 346), 0, false, null],
    ["SETTLE_S seconds past it, as it stood at the mark", sums(1050, [[1000, 330], [50, SETTLE_S]], 347), 0, false, { count: 1, units: "metric", timeS: 347 - SETTLE_S, lastS: 330 }],
    ["at a pause, at once", sums(1010, [[1000, 330], [10, 3]], 335), 0, true, { count: 1, units: "metric", timeS: 332, lastS: 330 }],
    ["a mark already said is not said again", sums(1050, [[1000, 330], [50, 20]], 352), 1, false, null],
    ["two marks passed at once (a gap in the signal): only the newer", sums(2060, [[1000, 330], [1000, 340], [60, 20]], 692), 0, false, { count: 2, units: "metric", timeS: 672, lastS: 340 }],
  ])("%s", (_name, now, said, settled, mark) => {
    expect(newMark(now, "metric", said, settled)).toEqual(mark);
  });

  it("a change from kilometres to miles mid-run says no mile already passed", () => {
    // 2.1 km said in kilometres; the person turns to miles: 1 mile was passed and is never said.
    let state: VoiceState = VOICE_START;
    state = voiceCheck(state, 700_000, "metric", () => sums(2100, [[1000, 330], [1000, 330], [100, 33]], 693, [[1609, 533], [491, 160]]), false).state;
    expect(state.said).toEqual({ metric: 2, imperial: 1 });
    const after = voiceCheck(state, 760_000, "imperial", () => sums(2300, [[1000, 330], [1000, 330], [300, 99]], 759, [[1609, 533], [691, 226]]), false);
    expect(after.line).toBeNull();
    // The second mile is said once it is passed and settled, in miles.
    const later = voiceCheck(after.state, 1_100_000, "imperial", () => sums(3300, [[1000, 330], [1000, 330], [1000, 330], [300, 99]], 1089, [[1609, 533], [1609, 533], [82, 23]]), false);
    expect(later.line).toBe("2 miles. Time 17 minutes 46 seconds. Last mile 8 minutes 53 seconds. Average pace 8 minutes 53 seconds per mile.");
  });

  it("waits for the next mark as long as it would take faster than anybody runs, never under CHECK_MS", () => {
    const far = voiceCheck(VOICE_START, 100_000, "metric", () => sums(500, [[500, 165]], 167), false);
    expect(far.state.nextAt).toBe(100_000 + (500 / 12.5) * 1000);
    const near = voiceCheck(VOICE_START, 100_000, "metric", () => sums(990, [[990, 330]], 332), false);
    expect(near.state.nextAt).toBe(100_000 + CHECK_MS);
    let worked = 0;
    voiceCheck(far.state, far.state.nextAt - 1, "metric", () => {
      worked += 1;
      return sums(900, [[900, 300]], 302);
    }, false);
    expect(worked).toBe(0);
  });
});
