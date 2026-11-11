// Today's planned run, step by step (ROADMAP 37d-ii). The worst thing first: the voice keeps a
// beginner running when the plan says walk. Every NHS Couch to 5K run is played through second by
// second as the phone does it (the clock's lines handed to the phone's voice ahead, a pause taking
// them back, the app closed and opened again), and what the person hears is timed.
import { describe, expect, it } from "vitest";
import { C25K_RUNS_A_WEEK, C25K_WEEK_COUNT, RUN_WARM_M, c25kParts, type KeptRunGuide, type PlanSession } from "@app/shared";
import {
  COOL_LEAST_M,
  DONE_LINE,
  HALFWAY,
  beginLine,
  guideAdvance,
  guideBar,
  guideDone,
  guideNextLook,
  guideOf,
  guideSchedule,
  guideSkip,
  leftOf,
  leftWords,
  nextWords,
  nowLine,
  skipLine,
  spokenDistance,
  spokenLength,
  stepName,
} from "../src/screens/running/runGuide";

const SESSIONS = C25K_WEEK_COUNT * C25K_RUNS_A_WEEK;
const walkRun = (index: number): PlanSession => ({ kind: "walk_run", week: Math.floor(index / 3) + 1, run: (index % 3) + 1, parts: c25kParts(index) });
const plain = (s: string): string => s.replace(/ /g, " ");

/** What the person is told to do by a line: run, walk, or nothing new. */
function told(line: string): "run" | "walk" | "done" | null {
  if (line.includes("complete")) return "done";
  if (/^(Last run\. )?Now run/.test(line)) return "run";
  if (/^(Now walk|Warm up with a brisk walk)/.test(line)) return "walk";
  return null;
}

interface Heard {
  wallMs: number;
  movingMs: number;
  text: string;
}

/** What the screen's step card says to do: run, walk, or that the run is complete. */
function shows(g: KeptRunGuide): "run" | "walk" | "done" {
  const step = g.steps[g.at.index];
  if (step === undefined) return "done";
  return step.kind === "run" ? "run" : "walk";
}

/** A Couch to 5K run played through as the recorder plays it, a point a second. `pauses` are
 *  [from, to] in wall seconds; `closed` is [from, to] in wall seconds while the app is closed (the
 *  person goes on doing what they last heard, and nothing handed over is said); `skips`, the wall
 *  seconds Skip step is pressed (37d-iii-a). Every line that says run or walk is checked against what
 *  the step card shows that same second. */
function play(guide: KeptRunGuide, opts: { pauses?: [number, number][]; closed?: [number, number] | null; skips?: number[] } = {}): { heard: Heard[]; guide: KeptRunGuide } {
  const pauses = opts.pauses ?? [];
  const closed = opts.closed ?? null;
  const skips = opts.skips ?? [];
  let g = guide;
  let ahead: { atWall: number; text: string }[] = [];
  const heard: Heard[] = [];
  let moving = 0;
  const hand = (wall: number) => {
    ahead = guideSchedule(g, moving, "metric").map((l) => ({ atWall: wall + l.inMs, text: l.text }));
  };
  heard.push({ wallMs: 0, movingMs: 0, text: beginLine(g, 0, "metric") });
  hand(0);
  const total = g.steps.reduce((t, s) => t + ("s" in s.until ? s.until.s : 0), 0) * 1000;
  let paused = false;
  let dead = false;
  // Each turn is one instant, `wall` ms after Go: what the person pressed then comes first, then what
  // the phone's voice says then, then a point; then a second passes.
  for (let wall = 0; !guideDone(g) || ahead.length > 0; wall += 1000) {
    if (wall > total * 3 + 3_600_000) throw new Error("never ended");
    const isPaused = pauses.some(([a, b]) => wall >= a * 1000 && wall < b * 1000);
    const isDead = closed !== null && wall >= closed[0] * 1000 && wall < closed[1] * 1000;
    const heardBefore = heard.length;
    if (isDead && !dead) {
      // The app is gone, and with it what was handed over.
      dead = true;
      ahead = [];
    } else if (dead && !isDead) {
      // Opened again: the guide read back, moved on, and what is left said at once if the step moved.
      dead = false;
      const was = g.at.index;
      g = guideAdvance(g, moving, () => 0).guide;
      if (g.at.index !== was) heard.push({ wallMs: wall, movingMs: moving, text: nowLine(g, moving, 0, "metric") });
      hand(wall);
    }
    if (!dead) {
      if (isPaused && !paused) {
        paused = true;
        g = guideAdvance(g, moving, () => 0).guide;
        ahead = [];
      } else if (!isPaused && paused) {
        // Run resumed: what to do now is said with it.
        paused = false;
        g = guideAdvance(g, moving, () => 0).guide;
        heard.push({ wallMs: wall, movingMs: moving, text: nowLine(g, moving, 0, "metric") });
        hand(wall);
      }
      if (skips.includes(wall / 1000)) {
        // As the recorder does: the guide to now, then the next step, said at once and handed over again.
        if (!isPaused) g = guideAdvance(g, moving, () => 0).guide;
        if (!guideDone(g)) {
          g = guideSkip(g, moving, 0);
          heard.push({ wallMs: wall, movingMs: moving, text: skipLine(g, "metric") });
          if (isPaused) ahead = [];
          else hand(wall);
        }
      }
      for (const line of ahead.filter((l) => l.atWall <= wall)) heard.push({ wallMs: line.atWall, movingMs: moving - (wall - line.atWall), text: line.text });
      ahead = ahead.filter((l) => l.atWall > wall);
      if (!isPaused) {
        const moved = guideAdvance(g, moving, () => 0);
        g = moved.guide;
        // A walk-run's steps are all by the clock: none of their lines is said here.
        expect(moved.begun.every((b) => b.byClock)).toBe(true);
      }
      for (const h of heard.slice(heardBefore)) {
        const what = told(h.text);
        if (what !== null) expect([h.movingMs, what]).toEqual([h.movingMs, shows(g)]);
      }
    }
    if (!isPaused) moving += 1000;
  }
  return { heard, guide: g };
}

/** How long each run lasted, in moving seconds: from the line that said run to the next that said walk or done. */
function runLengths(heard: Heard[]): number[] {
  const out: number[] = [];
  let from: number | null = null;
  for (const h of heard) {
    const what = told(h.text);
    if (what === "run" && from === null) from = h.movingMs;
    else if ((what === "walk" || what === "done") && from !== null) {
      out.push((h.movingMs - from) / 1000);
      from = null;
    }
  }
  expect(from).toBeNull();
  return out;
}

const planRuns = (index: number): number[] => c25kParts(index).filter((p) => p.kind === "run").map((p) => p.s);

describe("the worst thing: the voice keeps a beginner running when the plan says walk", () => {
  it.each(Array.from({ length: SESSIONS }, (_, i) => i))("NHS run %i: every run lasts exactly the plan's time, and every walk is said", (index) => {
    const { heard } = play(guideOf(walkRun(index), "t"));
    expect(runLengths(heard)).toEqual(planRuns(index));
    expect(heard.filter((h) => told(h.text) === "done")).toHaveLength(1);
  });

  it.each(Array.from({ length: SESSIONS }, (_, i) => i))("NHS run %i with three pauses, one in each kind of step: no run is longer than the plan's", (index) => {
    const parts = c25kParts(index);
    // A pause in the warm-up, one in the first run and one near the end, at a wall time made to land inside.
    const firstRunEnd = (parts[0]?.s ?? 0) + (parts[1]?.s ?? 0);
    const { heard } = play(guideOf(walkRun(index), "t"), { pauses: [[120, 150], [firstRunEnd + 10, firstRunEnd + 47], [firstRunEnd + 400, firstRunEnd + 401]] });
    expect(runLengths(heard)).toEqual(planRuns(index));
  });

  it("a pause a second before a walk begins: Resume says run, and the walk comes a second later", () => {
    // NHS run 1's first run ends at 360 s: paused from 359 to 420.
    const { heard } = play(guideOf(walkRun(0), "t"), { pauses: [[359, 420]] });
    expect(runLengths(heard)).toEqual(planRuns(0));
    expect(heard.filter((h) => h.wallMs >= 359_000 && h.wallMs <= 421_000).map((h) => h.text)).toEqual(["Now run. 1 second left.", "Now walk for 1 and a half minutes."]);
  });

  it("a pause on the very second a walk begins, before the phone's voice said it: Resume says walk", () => {
    const { heard } = play(guideOf(walkRun(0), "t"), { pauses: [[360, 420]] });
    expect(runLengths(heard)).toEqual(planRuns(0));
    expect(heard.filter((h) => h.wallMs >= 360_000 && h.wallMs <= 421_000).map((h) => h.text)).toEqual(["Now walk. 1 minute 30 seconds left."]);
  });

  it.each(Array.from({ length: SESSIONS }, (_, i) => i))("NHS run %i, the app closed for 2 minutes in the middle: opened again, what to do now is said at once", (index) => {
    const parts = c25kParts(index);
    const total = parts.reduce((t, p) => t + p.s, 0);
    const mid = Math.floor(total / 2);
    const { heard } = play(guideOf(walkRun(index), "t"), { closed: [mid, mid + 120] });
    // What the person heard last before the gap, and the first line after it.
    const before = heard.filter((h) => h.wallMs <= mid * 1000).at(-1);
    const after = heard.find((h) => h.wallMs > mid * 1000);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    // Whatever changed while closed, the person is told within a second of opening; a run the app was
    // closed through lasts no longer than the plan's run and the time it was closed.
    const lengths = runLengths(heard);
    const plan = planRuns(index);
    lengths.forEach((s, i) => {
      expect(s).toBeLessThanOrEqual((plan[i] ?? 0) + 120);
    });
    const reopened = heard.find((h) => h.wallMs === (mid + 120) * 1000);
    if (reopened !== undefined) expect(reopened.text).toMatch(/^(Now run|Now walk|Warm-up|Cool-down|Today's run is complete)/);
  });

  it("closed across a walk beginning: opened again, it says walk now with what is left, never the run again", () => {
    // NHS run 1: the first run is 300 to 360 s; closed from 340 to 400, the walk began at 360.
    const { heard } = play(guideOf(walkRun(0), "t"), { closed: [340, 400] });
    const reopened = heard.find((h) => h.wallMs === 400_000);
    expect(reopened?.text).toBe("Now walk. 50 seconds left.");
    expect(heard.filter((h) => h.wallMs >= 340_000 && h.wallMs < 400_000)).toEqual([]);
  });

  it("the walks before and after are the plan's 5 minutes, and the whole time is the plan's", () => {
    for (let i = 0; i < SESSIONS; i++) {
      const g = guideOf(walkRun(i), "t");
      expect(g.steps[0]).toEqual({ kind: "warm_walk", until: { s: 300 }, rep: null });
      expect(g.steps.at(-1)).toEqual({ kind: "cool_walk", until: { s: 300 }, rep: null });
      expect(g.steps.reduce((t, s) => t + ("s" in s.until ? s.until.s : 0), 0)).toBe(c25kParts(i).reduce((t, p) => t + p.s, 0));
      expect(g.walkRun).toBe(true);
    }
  });
});

/** Where step `k` begins in the plan, in seconds. */
const planStart = (index: number, k: number): number => c25kParts(index).slice(0, k).reduce((t, p) => t + p.s, 0);
const EVERY_STEP = Array.from({ length: SESSIONS }, (_, i) => i).flatMap((i) => c25kParts(i).map((_, k) => [i, k] as const));

describe("Skip step (37d-iii-a): the voice never says run while the screen says walk", () => {
  it.each(EVERY_STEP)("NHS run %i, step %i skipped 7 seconds in: the next step said at once, every other run the plan's own, each step said once", (index, k) => {
    const parts = c25kParts(index);
    const at = planStart(index, k) + 7;
    const { heard, guide } = play(guideOf(walkRun(index), "t"), { skips: [at] });
    const pressed = heard.find((h) => h.wallMs === at * 1000 && told(h.text) !== null);
    expect(pressed?.text).toBe(k === parts.length - 1 ? DONE_LINE : beginLine(guide, k + 1, "metric"));
    const runs = planRuns(index);
    const skippedRun = parts.slice(0, k + 1).filter((p) => p.kind === "run").length - 1;
    const expected = parts[k]?.kind === "run" ? runs.map((s, r) => (r === skippedRun ? 7 : s)) : runs;
    expect(runLengths(heard)).toEqual(expected);
    // Each step begun once, and the run complete once, at the plan's time less what was skipped.
    expect(heard.filter((h) => told(h.text) !== null)).toHaveLength(parts.length + 1);
    const total = parts.reduce((t, p) => t + p.s, 0);
    expect(heard.filter((h) => told(h.text) === "done").map((h) => h.movingMs)).toEqual([(total - ((parts[k]?.s ?? 0) - 7)) * 1000]);
    expect(guideDone(guide)).toBe(true);
  });

  it.each(Array.from({ length: SESSIONS }, (_, i) => i))("NHS run %i, the warm-up skipped at 60 s: halfway is said once, at the plan's halfway less the 4 minutes skipped", (index) => {
    const total = c25kParts(index).reduce((t, p) => t + p.s, 0);
    const { heard } = play(guideOf(walkRun(index), "t"), { skips: [60] });
    const half = heard.filter((h) => h.text.includes(HALFWAY));
    expect(half).toHaveLength(1);
    // Said with a step's line when within 15 s of one.
    expect(Math.abs((half[0]?.movingMs ?? 0) / 1000 - (total / 2 - 240))).toBeLessThan(15);
  });

  it("a skip past the plan's halfway never says it later", () => {
    // NHS run 16 (week 6 run 1): 5, 5, 3, 8, 3, 5, 5 minutes: halfway at 17 min, inside the 8-minute run.
    const index = C25K_RUNS_A_WEEK * 5;
    const parts = c25kParts(index);
    const runStart = planStart(index, 3);
    expect(parts[3]).toEqual({ kind: "run", s: 480 });
    expect(runStart).toBeLessThan(parts.reduce((t, p) => t + p.s, 0) / 2);
    const { heard } = play(guideOf(walkRun(index), "t"), { skips: [runStart + 60] });
    expect(heard.filter((h) => h.text.includes(HALFWAY))).toEqual([]);
  });

  it("skipped while paused: the next step is said at the press, Resume says it again with what is left, and it lasts its full time", () => {
    // NHS run 1: paused in the first run (300 to 360 s) from 320, skipped at 330, resumed at 400.
    const { heard } = play(guideOf(walkRun(0), "t"), { pauses: [[320, 400]], skips: [330] });
    expect(heard.filter((h) => h.wallMs >= 320_000 && h.wallMs <= 400_000).map((h) => h.text)).toEqual(["Now walk for 1 and a half minutes.", "Now walk. 1 minute 30 seconds left."]);
    expect(runLengths(heard)).toEqual(planRuns(0).map((s, r) => (r === 0 ? 20 : s)));
  });

  it("a skip, then the app closed and opened again: it carries on from the step skipped to", () => {
    // NHS run 1: the warm-up skipped at 10 s, so the first run is 10 to 70 s; closed from 50 to 100.
    const { heard } = play(guideOf(walkRun(0), "t"), { skips: [10], closed: [50, 100] });
    expect(heard.find((h) => h.wallMs === 100_000)?.text).toBe("Now walk. 1 minute left.");
  });

  it("two presses skip two steps from the same second, and nothing is skipped past the end", () => {
    let g = guideOf(walkRun(0), "t");
    g = guideSkip(g, 5000, 0);
    g = guideSkip(g, 5000, 0);
    expect(g.at).toEqual({ index: 2, fromMs: 5000, fromM: 0 });
    expect(skipLine(g, "metric")).toBe("Now walk for 1 and a half minutes.");
    const end = { ...g, at: { index: g.steps.length, fromMs: 5000, fromM: 0 } };
    expect(guideSkip(end, 9000, 0)).toBe(end);
  });

  it("a skip never moves the step's start back, so what is left is never more than the step", () => {
    const g = guideAdvance(guideOf(walkRun(0), "t"), 300_000, () => 0).guide;
    const skipped = guideSkip(g, 200_000, 0);
    expect(skipped.at.fromMs).toBe(300_000);
    expect(leftOf(skipped, 300_000, 0)).toEqual({ kind: "s", amount: 90 });
  });
});

describe("what the voice says in a Couch to 5K run", () => {
  it("NHS run 1, line by line, at the plan's seconds", () => {
    const { heard } = play(guideOf(walkRun(0), "t"));
    const said = heard.map((h) => [h.movingMs / 1000, h.text]);
    expect(said.slice(0, 4)).toEqual([
      [0, "Warm up with a brisk walk for 5 minutes."],
      [300, "Now run for 1 minute."],
      [360, "Now walk for 1 and a half minutes."],
      [450, "Now run for 1 minute."],
    ]);
    // 28½ minutes in all: halfway at 14 min 15 s, inside a walk, said on its own.
    expect(said).toContainEqual([855, HALFWAY]);
    expect(said.at(-3)).toEqual([1350, "Last run. Now run for 1 minute."]);
    expect(said.at(-2)).toEqual([1410, "Now walk for 5 minutes to cool down."]);
    expect(said.at(-1)).toEqual([1710, DONE_LINE]);
  });

  it("halfway within 15 seconds of a step is said with that step's line, after it", () => {
    // NHS run 14 (week 5 run 3): 5, 20, 5 minutes: halfway at 15 minutes, inside the run, on its own.
    const lines = guideSchedule(guideOf(walkRun(14), "t"), 0, "metric");
    expect(lines.map((l) => [l.inMs / 1000, l.text])).toEqual([
      [300, "Now run for 20 minutes."],
      [900, HALFWAY],
      [1500, "Now walk for 5 minutes to cool down."],
      [1800, DONE_LINE],
    ]);
    const close = { ...guideOf(walkRun(0), "t"), steps: [{ kind: "warm_walk" as const, until: { s: 300 }, rep: null }, { kind: "run" as const, until: { s: 10 }, rep: null }, { kind: "cool_walk" as const, until: { s: 300 }, rep: null }] };
    // 610 s, halfway 305: 5 s after the run began at 300.
    expect(guideSchedule(close, 0, "metric")[0]).toEqual({ inMs: 300_000, text: `Now run for 10 seconds. ${HALFWAY}` });
  });

  it("handed over again later, only what is still to come", () => {
    const g = guideAdvance(guideOf(walkRun(0), "t"), 400_000, () => 0).guide;
    const lines = guideSchedule(g, 400_000, "metric");
    expect(lines[0]).toEqual({ inMs: 50_000, text: "Now run for 1 minute." });
    expect(lines.every((l) => l.inMs > 0)).toBe(true);
  });

  it("nothing handed over once the run is complete", () => {
    const g = guideAdvance(guideOf(walkRun(0), "t"), 1_710_000, () => 0).guide;
    expect(guideDone(g)).toBe(true);
    expect(guideSchedule(g, 1_710_000, "metric")).toEqual([]);
    expect(guideNextLook(g, 1_710_000, () => 0)).toBe(Infinity);
  });
});

describe("a runner's planned run", () => {
  const tempo: PlanSession = { kind: "steady", m: 8000, reps: { count: 3, m: 1000, restS: 60 } };
  const intervals: PlanSession = { kind: "fast", m: 9000, reps: { count: 5, m: 800, restS: 150 } };

  /** Played at a steady 3 m a second (5:33 a km), a point a second; the distance's lines said as the
   *  points show them, the clock's handed over ahead. */
  function playRunner(session: PlanSession, units: "metric" | "imperial" = "metric", skips: number[] = []): { heard: [number, number, string][]; guide: KeptRunGuide } {
    let g = guideOf(session, "t");
    const heard: [number, number, string][] = [[0, 0, beginLine(g, 0, units)]];
    let ahead = guideSchedule(g, 0, units).map((l) => ({ at: l.inMs, text: l.text }));
    for (let ms = 1000; ms < 7_200_000; ms += 1000) {
      const metres = (ms / 1000) * 3;
      // Skip step (37d-iii-a), pressed first in its second, as the recorder does it.
      if (skips.includes(ms / 1000)) {
        g = guideAdvance(g, ms, () => metres).guide;
        if (!guideDone(g)) {
          g = guideSkip(g, ms, metres);
          heard.push([ms / 1000, metres, skipLine(g, units)]);
          ahead = guideSchedule(g, ms, units).map((l) => ({ at: ms + l.inMs, text: l.text }));
        }
      }
      for (const l of ahead.filter((a) => a.at <= ms)) heard.push([l.at / 1000, (l.at / 1000) * 3, l.text]);
      ahead = ahead.filter((a) => a.at > ms);
      const moved = guideAdvance(g, ms, () => metres);
      g = moved.guide;
      const last = moved.begun.at(-1);
      if (last !== undefined && !moved.begun.every((b) => b.byClock)) {
        heard.push([ms / 1000, metres, beginLine(g, last.index, units)]);
        ahead = guideSchedule(g, ms, units).map((l) => ({ at: ms + l.inMs, text: l.text }));
      }
      if (guideDone(g) && ahead.length === 0) break;
    }
    return { heard, guide: g };
  }

  it("a tempo run: warm-up by distance, each repeat by distance, a jog by the clock between, and a cool-down to the day's distance", () => {
    const { heard } = playRunner(tempo);
    expect(heard.map(([s, m, text]) => [s, m, text])).toEqual([
      [0, 0, "Warm up with easy running for 1.5 kilometres."],
      [500, 1500, "Repeat 1 of 3. Run 1 kilometre at tempo pace."],
      [834, 2502, "Jog easy for 1 minute to recover."],
      [894, 2682, "Repeat 2 of 3. Run 1 kilometre at tempo pace."],
      [1228, 3684, "Jog easy for 1 minute to recover."],
      [1288, 3864, "Repeat 3 of 3. Run 1 kilometre at tempo pace."],
      [1622, 4866, "Now cool down with easy running."],
      [2667, 8001, DONE_LINE],
    ]);
  });

  it("intervals: five repeats of 800 m with 2½ minutes' jog, and the run ends at its distance", () => {
    const { heard, guide } = playRunner(intervals);
    const reps = heard.filter(([, , t]) => t.startsWith("Repeat"));
    expect(reps.map(([, , t]) => t)).toEqual([1, 2, 3, 4, 5].map((n) => `Repeat ${String(n)} of 5. Run 800 metres at interval pace.`));
    expect(heard.filter(([, , t]) => t === "Jog easy for 2 and a half minutes to recover.")).toHaveLength(4);
    expect(heard.at(-1)?.[2]).toBe(DONE_LINE);
    expect(heard.at(-1)?.[1]).toBeGreaterThanOrEqual(9000);
    expect(heard.at(-1)?.[1]).toBeLessThan(9004);
    expect(guideDone(guide)).toBe(true);
  });

  it("a cool-down whose room the jogs took is still at least 1 km", () => {
    const tight: PlanSession = { kind: "fast", m: 2 * RUN_WARM_M + 3 * 800, reps: { count: 3, m: 800, restS: 300 } };
    const { heard } = playRunner(tight);
    const cool = heard.find(([, , t]) => t === "Now cool down with easy running.");
    const done = heard.at(-1);
    expect(done?.[2]).toBe(DONE_LINE);
    // Heard at the first point past the repeat's end: within a point's 3 m of it.
    expect((done?.[1] ?? 0) - (cool?.[1] ?? 0)).toBeGreaterThanOrEqual(COOL_LEAST_M - 3);
    expect((done?.[1] ?? 0) - (cool?.[1] ?? 0)).toBeLessThan(COOL_LEAST_M + 4);
  });

  const byDistance: [PlanSession, string, string][] = [
    // A whole kilometre is said by the kilometre voice as it is reached: the guide does not say it again.
    [{ kind: "easy", m: 6000, reps: null }, "Today's run: 6 kilometres at an easy pace.", ""],
    [{ kind: "long", m: 12500, reps: null }, "Today's long run: 12.5 kilometres at an easy pace.", "That's 12.5 kilometres. "],
    [{ kind: "steady", m: 5000, reps: null }, "Today's run: 5 kilometres at an easy pace.", ""],
  ];
  it.each(byDistance)("an easy or long run says its distance at the start and, unless the kilometre voice just said it, when it is reached", (session, first, last) => {
    const { heard } = playRunner(session);
    expect(heard[0]?.[2]).toBe(first);
    expect(heard.at(-1)?.[2]).toBe(`${last}${DONE_LINE}`);
    expect(heard).toHaveLength(2);
  });

  it("in miles: the warm-up in miles, a 1.6 km repeat a mile, 800 m as a track says it", () => {
    expect(spokenDistance(RUN_WARM_M, "imperial")).toBe("0.9 miles");
    expect(spokenDistance(1600, "imperial")).toBe("1 mile");
    expect(spokenDistance(800, "imperial")).toBe("800 metres");
    expect(spokenDistance(6000, "imperial")).toBe("3.7 miles");
    expect(spokenDistance(1000, "metric")).toBe("1 kilometre");
    expect(beginLine(guideOf({ kind: "steady", m: 12000, reps: { count: 2, m: 1600, restS: 60 } }, "t"), 1, "imperial")).toBe("Repeat 1 of 2. Run 1 mile at tempo pace.");
  });

  it("in miles a whole mile is said by the mile voice, and 6 km is not a whole mile", () => {
    expect(beginLine(guideOf({ kind: "easy", m: 8047, reps: null }, "t"), 1, "imperial")).toBe(DONE_LINE);
    expect(beginLine(guideOf({ kind: "easy", m: 6000, reps: null }, "t"), 1, "imperial")).toBe(`That's 3.7 miles. ${DONE_LINE}`);
  });

  it("the jog after a repeat is timed from where the distance was reached, not from a late batch of points", () => {
    const g = guideOf(tempo, "t");
    // The warm-up's 1.5 km were reached at 500 s; the points showing it came at 530 s.
    const moved = guideAdvance(g, 530_000, () => 1600, (m) => (m === RUN_WARM_M ? 500_000 : 530_000));
    expect(moved.guide.at).toEqual({ index: 1, fromMs: 500_000, fromM: RUN_WARM_M });
    // Never later than now, never earlier than the step before began.
    expect(guideAdvance(g, 530_000, () => 1600, () => 900_000).guide.at.fromMs).toBe(530_000);
  });

  it("Skip step on the warm-up: the first repeat begins where the person is, and runs its whole distance", () => {
    // 200 s in, at 600 m of the 1.5 km warm-up.
    const { heard } = playRunner(tempo, "metric", [200]);
    expect(heard.slice(0, 3)).toEqual([
      [0, 0, "Warm up with easy running for 1.5 kilometres."],
      [200, 600, "Repeat 1 of 3. Run 1 kilometre at tempo pace."],
      [534, 1602, "Jog easy for 1 minute to recover."],
    ]);
    expect(heard.at(-1)?.[2]).toBe(DONE_LINE);
    expect(heard.at(-1)?.[1]).toBeGreaterThanOrEqual(8000);
  });

  it("Skip step on a recovery jog: the next repeat is said once, at the press, and the jog's line never comes late", () => {
    // Intervals: the warm-up ends at 500 s, the first 800 m at 767 s; the jog of 150 s skipped at 800 s.
    const { heard } = playRunner(intervals, "metric", [800]);
    const rep2 = heard.filter(([, , t]) => t === "Repeat 2 of 5. Run 800 metres at interval pace.");
    expect(rep2).toEqual([[800, 2400, "Repeat 2 of 5. Run 800 metres at interval pace."]]);
    expect(heard.filter(([, , t]) => t.startsWith("Repeat"))).toHaveLength(5);
    expect(heard.filter(([, , t]) => t.startsWith("Jog easy"))).toHaveLength(4);
    expect(heard.filter(([, , t]) => t === DONE_LINE)).toHaveLength(1);
  });

  it("Skip step on the cool-down, or on an easy run's only step: the run is complete, and no distance is said that was not run", () => {
    const cool = playRunner(tempo, "metric", [2000]);
    expect(cool.heard.at(-1)).toEqual([2000, 6000, DONE_LINE]);
    expect(guideDone(cool.guide)).toBe(true);
    const long = playRunner({ kind: "long", m: 12500, reps: null }, "metric", [700]);
    expect(long.heard).toEqual([
      [0, 0, "Today's long run: 12.5 kilometres at an easy pace."],
      [700, 2100, DONE_LINE],
    ]);
  });

  it("a step by distance is looked at no sooner than the fastest runner alive could end it, and never less than a second apart", () => {
    const g = guideOf(tempo, "t");
    expect(guideNextLook(g, 10_000, () => 250)).toBe(10_000 + 100_000);
    expect(guideNextLook(g, 10_000, () => 1499)).toBe(11_000);
  });
});

describe("the screen's words", () => {
  it("names each step as running apps do, with what is left and what is next", () => {
    const g = guideOf(walkRun(0), "Run 1 · 28½ min");
    const nameAt = (guide: KeptRunGuide) => {
      const step = guide.steps[guide.at.index];
      return step === undefined ? null : stepName(step);
    };
    expect(nameAt(g)).toBe("Warm-up walk");
    expect(plain(leftWords(g, 42_000, 0, "metric"))).toBe("4:18 left");
    expect(plain(nextWords(g, "metric"))).toBe("Next: Run 1 min");
    const later = guideAdvance(g, 360_000, () => 0).guide;
    expect(plain(nextWords(later, "metric"))).toBe("Next: Run 1 min");
    expect(nameAt(later)).toBe("Walk");
    const t = guideOf({ kind: "steady", m: 8000, reps: { count: 3, m: 1000, restS: 60 } }, "t");
    expect(t.steps.map(stepName)).toEqual(["Warm-up", "Tempo 1 of 3", "Recovery jog", "Tempo 2 of 3", "Recovery jog", "Tempo 3 of 3", "Cool-down"]);
    expect(plain(leftWords(t, 0, 940, "metric"))).toBe("0.6 km left");
    expect(plain(nextWords(t, "metric"))).toBe("Next: Tempo 1 of 3 1.0 km");
    // A jog of 3:20, as the voice says it, not rounded down to 3 min.
    const jog = guideOf({ kind: "fast", m: 9000, reps: { count: 3, m: 800, restS: 200 } }, "t");
    expect(plain(nextWords(guideAdvance(jog, 1, () => RUN_WARM_M).guide, "metric"))).toBe("Next: Recovery jog 3:20");
  });

  it("the bar gives each step its share of the time, runs apart from walks", () => {
    const bar = guideBar(guideOf(walkRun(0), "t"));
    expect(bar[0]).toEqual({ weight: 300, running: false });
    expect(bar[1]).toEqual({ weight: 60, running: true });
    expect(bar[2]).toEqual({ weight: 90, running: false });
  });

  it("lengths as a voice reads them", () => {
    expect(spokenLength(90)).toBe("1 and a half minutes");
    expect(spokenLength(150)).toBe("2 and a half minutes");
    expect(spokenLength(60)).toBe("1 minute");
    expect(spokenLength(300)).toBe("5 minutes");
    expect(spokenLength(45)).toBe("45 seconds");
    expect(spokenLength(30)).toBe("30 seconds");
    expect(spokenLength(195)).toBe("3 minutes 15 seconds");
  });
});
