// Mode-A FSM tests (§3.6) — every guard with pass AND fail cases.
import { describe, expect, it } from "vitest";
import { MIN_REP_INTERVAL_MS, ModeAFsm, NotImplementedError } from "../../src/index.js";

const SQUAT = {
  mode: "alternating_threshold" as const,
  upAt: 160,
  downAt: 100,
  countOn: "up" as const,
  bilateralGate: true,
};
const FRAME = 66.7;

/** Feed a sequence of (metric, other) pairs; returns final rep count. */
function run(fsm: ModeAFsm, seq: [number | null, number | null][], startT = 0): number {
  let t = startT;
  let reps = 0;
  for (const [m, o] of seq) {
    reps = fsm.update(t, m, o).repCount;
    t += FRAME;
  }
  return reps;
}

/** A clean rep: hold top, descend deep, hold bottom, ascend, hold top. */
function cleanRep(bottomFrames = 4, topFrames = 4): [number, number][] {
  const seq: [number, number][] = [];
  // NOTE: 7-sample smoothing means raw values must be extreme enough for the
  // MEAN to cross thresholds. Use flat plateaus like real motion.
  for (let i = 0; i < 8; i++) seq.push([175, 175]); // settle top
  for (const v of [150, 120]) seq.push([v, v]); // descend
  for (let i = 0; i < Math.max(bottomFrames, 7); i++) seq.push([80, 80]); // deep bottom (mean sinks <100)
  for (const v of [120, 150]) seq.push([v, v]); // ascend
  for (let i = 0; i < Math.max(topFrames, 8); i++) seq.push([178, 178]); // top (mean rises >160)
  return seq;
}

describe("Mode A counting (RepCounter port)", () => {
  it("counts one clean rep; counts N for N cycles", () => {
    const fsm = new ModeAFsm(SQUAT);
    expect(run(fsm, cleanRep())).toBe(1);
    const fsm3 = new ModeAFsm(SQUAT);
    expect(run(fsm3, [...cleanRep(), ...cleanRep(), ...cleanRep()])).toBe(3);
  });

  it("null metric holds state and reports isActive:false (no-decision)", () => {
    const fsm = new ModeAFsm(SQUAT);
    const seq = cleanRep();
    run(fsm, seq.slice(0, 14)); // mid-bottom
    const r = fsm.update(14 * FRAME, null, null);
    expect(r.isActive).toBe(false);
    expect(r.currentMetric).toBeNull();
    expect(r.repCount).toBe(0);
    // finish the rep normally afterwards — nothing was reset
    expect(run(fsm, seq.slice(14), 15 * FRAME)).toBe(1);
  });

  it("a 2-frame dip is a flicker, not a rep (min 3 down frames)", () => {
    const fsm = new ModeAFsm(SQUAT);
    const seq: [number, number][] = [];
    for (let i = 0; i < 8; i++) seq.push([175, 175]);
    seq.push([60, 60], [60, 60]); // only 2 frames deep — mean dips below 100 briefly
    for (let i = 0; i < 10; i++) seq.push([178, 178]);
    expect(run(fsm, seq)).toBe(0);
  });

  it("bilateral gate: one-legged phantom squat rejected when both knees visible", () => {
    const fsm = new ModeAFsm(SQUAT);
    // primary knee descends, other knee stays straight (~175)
    const seq: [number, number][] = [];
    for (let i = 0; i < 8; i++) seq.push([175, 175]);
    for (let i = 0; i < 10; i++) seq.push([80, 175]);
    for (let i = 0; i < 10; i++) seq.push([178, 175]);
    expect(run(fsm, seq)).toBe(0);
  });

  it("bilateral gate: occluded other leg falls back to single-knee counting", () => {
    const fsm = new ModeAFsm(SQUAT);
    const seq: [number | null, number | null][] = cleanRep().map(([m]) => [m, null]);
    expect(run(fsm, seq)).toBe(1);
  });

  it("min rep interval: two full cycles inside 450 ms count once", () => {
    const fsm = new ModeAFsm(SQUAT);
    // Two rapid cycles at 20 ms/frame ⇒ second completion lands < 450 ms
    // after the first (plateaus long enough for the 7-sample mean to cross).
    let t = 0;
    let reps = 0;
    const fast = (v: number) => {
      reps = fsm.update(t, v, v).repCount;
      t += 20;
    };
    for (let i = 0; i < 8; i++) fast(175);
    for (let i = 0; i < 10; i++) fast(70);
    for (let i = 0; i < 8; i++) fast(178);
    const afterFirst = reps;
    for (let i = 0; i < 10; i++) fast(70);
    for (let i = 0; i < 8; i++) fast(178);
    expect(afterFirst).toBe(1);
    expect(reps).toBe(1); // second cycle completed too fast — rejected
    expect(MIN_REP_INTERVAL_MS).toBe(450);
  });

  it("rep completion carries romExtreme and phase timings", () => {
    const fsm = new ModeAFsm(SQUAT);
    let completed;
    let t = 0;
    for (const [m, o] of cleanRep()) {
      const r = fsm.update(t, m, o);
      if (r.completed) completed = r.completed;
      t += FRAME;
    }
    expect(completed).toBeDefined();
    expect(completed?.romExtreme).toBeLessThan(100);
    expect(completed?.durationMs).toBeGreaterThan(0);
    expect((completed?.phaseTimings.descent ?? 0) + (completed?.phaseTimings.ascent ?? 0)).toBeGreaterThan(0);
  });

  it("countOn 'down' throws NotImplementedError (no port source, P1.6b+)", () => {
    expect(() => new ModeAFsm({ ...SQUAT, countOn: "down" })).toThrow(NotImplementedError);
  });
});
