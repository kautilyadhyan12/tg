// Every rule of the squat, one at a time (ROADMAP 52a-i, round one): a squat rep made by hand from measures, which
// counts, then the same rep with exactly one thing changed, which each rule alone must refuse, by its own name and in
// its own way ("short" with its reason for how far, silence for what kind, nothing decided for what was not seen).
// A table over every class of case, as CLAUDE.md §4 asks of a rule that thresholds.
import { describe, expect, it } from "vitest";
import { movementSchema } from "@app/shared";
import { KP } from "@app/shared";
import { MEASURE_LIST, MovementMatcher, parseMovement, type MeasureName, type MeasuredBody, type Reading, type SteadyBody, type SteadyPoint } from "../src/index.js";
import { readMovement } from "../scripts/movementCheck.js";

const SQUAT = readMovement("squat");
const bound = (name: string): number => {
  const r = SQUAT.rules.find((x) => x.name === name);
  const b = r?.atLeast ?? r?.atMost;
  if (b === undefined) throw new Error(`no rule ${name}`);
  return b;
};

/** How far down the rep is at time t (ms), 0 standing to 1 at the bottom: standing 1.5 s, down 1 s, a moment at the
 *  bottom, up 0.8 s, standing again. `fast` squeezes the whole rep into 0.2 s. */
function depthAt(t: number, fast = false): number {
  const [down, bottom, up, back] = fast ? [1500, 1600, 1600, 1700] : [1500, 2500, 2800, 3600];
  if (t <= down || t >= back) return 0;
  if (t < bottom) return (t - down) / (bottom - down);
  if (t <= up) return 1;
  return (back - t) / (back - up);
}

interface Body {
  hips: number;
  knee: number;
  hipAngle: number;
  trunk: number;
  ankles: number;
  feetApart: number;
  hipsLR: number;
  /** How far the heels and toes are moved on the picture, picture heights. */
  feetX: number;
  feetY: number;
  /** Knees read at all. */
  kneesSeen: boolean;
  /** For one foot point, how far it alone is moved on the picture (picture heights), or "hidden". */
  each: Map<number, readonly [number, number] | "hidden">;
}
type Change = (t: number, p: number, b: Body) => void;

const ASPECT = 9 / 16;
const SIZE = 0.5;
const FEET: readonly number[] = [KP.left_heel, KP.left_foot_index, KP.right_heel, KP.right_foot_index];

/** A rep made by hand at 30 frames a second for 5 s, changed by `change`, run through the matcher. */
function run(change?: Change, fast = false) {
  const m = new MovementMatcher(SQUAT);
  const reps = [];
  for (let n = 0; n * (1000 / 30) <= 5000; n++) {
    const t = Math.round((n * 1000 * 10) / 30) / 10;
    const p = depthAt(t, fast);
    const b: Body = {
      hips: 1.15 - 0.45 * p,
      knee: 175 - 85 * p,
      hipAngle: 168 - 85 * p,
      trunk: 3 + 30 * p,
      ankles: 0.2,
      feetApart: 0.6,
      hipsLR: 3,
      feetX: 0,
      feetY: 0,
      kneesSeen: true,
      each: new Map(),
    };
    change?.(t, p, b);
    const value = new Map<string, number | null>([
      ["hips height", b.hips],
      ["left knee", b.kneesSeen ? b.knee : null],
      ["right knee", b.kneesSeen ? b.knee : null],
      ["left hip", b.hipAngle],
      ["right hip", b.hipAngle],
      ["trunk lean", b.trunk],
      ["left ankle height", b.ankles],
      ["right ankle height", b.ankles],
      ["feet apart", b.feetApart],
      ["hips, left against right", b.hipsLR],
    ]);
    const readings = new Map<MeasureName, Reading>(
      MEASURE_LIST.map(({ name }) => {
        const v = value.get(name) ?? null;
        return [name, { flat: v, world: v, shown: v === null ? null : 1, off: v === null ? null : 0 }];
      }),
    );
    const points: (SteadyPoint | null)[] = Array.from({ length: 33 }, (_, i) => {
      if (!FEET.includes(i)) return { x: 0.5, y: 0.5, world: [0, 0, 0], raw: { x: 0.5, y: 0.5 } };
      const alone = b.each.get(i);
      if (alone === "hidden") return null;
      const side = i === KP.left_heel || i === KP.left_foot_index ? 0.05 : -0.05;
      const toe = i === KP.left_foot_index || i === KP.right_foot_index ? 0.03 : 0;
      const x = (0.5 + side + toe + b.feetX + (alone?.[0] ?? 0)) / ASPECT;
      const y = 0.9 + b.feetY + (alone?.[1] ?? 0);
      return { x, y, world: [0, 0, 0], raw: { x, y } };
    });
    const body: SteadyBody = { t, aspect: ASPECT, down: [0, 1, 0], size: SIZE, points, refused: points.map(() => null) };
    const measured: MeasuredBody = { t, leg: 0.9, trunk: 0.5, onFloor: true, readings };
    const f = m.next(body, measured);
    if (f.rep !== null) reps.push(f.rep);
  }
  const last = m.finish();
  if (last?.rep) reps.push(last.rep);
  return reps.map((r) => [r.verdict, r.rule]);
}

describe("each rule of the squat refuses on its own, by its own name", () => {
  it("the rep made by hand counts: every rule holds", () => {
    expect(run()).toEqual([["counted", null]]);
  });

  const cases: readonly (readonly [string, Change | "fast", readonly [string, string]])[] = [
    // How far: not counted, and it says why.
    ["not deep enough", (_t, p, b) => (b.hips = 1.15 - (bound("depth") * 0.8) * p), ["short", "depth"]],
    ["the knees not bent enough", (_t, p, b) => ((b.knee = 175 - (175 - bound("knees bent") - 12) * p), (b.hipAngle = b.knee - 8)), ["short", "knees bent"]],
    // A dip that started a rep and never tried (the knees less than half way to their number): no word.
    ["a dip that went deep enough but barely bent the knees", (_t, p, b) => ((b.hips = 1.15 - (bound("depth") + 0.05) * p), (b.knee = 175 - 30 * p), (b.hipAngle = b.knee - 8)), ["other", "knees bent"]],
    ["a dip that bent the knees but barely went down", (_t, p, b) => (b.hips = 1.15 - bound("depth") * 0.6 * p), ["other", "depth"]],
    // What kind: no count, no word.
    ["the hips bend far more than the knees (a deadlift)", (_t, p, b) => (b.hipAngle = 168 - (85 + bound("hips and knees together") + 15) * p), ["other", "hips and knees together"]],
    ["the knees bend far more than the hips (a split squat's front leg)", (_t, p, b) => (b.hipAngle = b.knee - (bound("knees and hips together") - 10) * p), ["other", "knees and hips together"]],
    ["the chest drops", (_t, p, b) => (b.trunk = 3 + (bound("chest up") + 15) * p), ["other", "chest up"]],
    ["the feet leave the floor at the top (a jump)", (t, _p, b) => (b.feetY = t > 3550 && t < 3800 ? -(bound("feet stay down") + 0.05) * SIZE : 0), ["other", "feet stay down"]],
    ["a foot steps out at the bottom", (_t, p, b) => (b.feetX = p > 0.5 ? (bound("feet stay in place") + 0.05) * SIZE : 0), ["other", "feet stay in place"]],
    ["the stance widens during the rep (a squat jack)", (_t, p, b) => (b.feetApart = 0.6 + (bound("stance holds") + 0.1) * p), ["other", "stance holds"]],
    ["one hip bends and the other does not (a lunge)", (_t, p, b) => (b.hipsLR = 3 + (bound("hips alike") + 15) * p), ["other", "hips alike"]],
    // Not seen: nothing decided.
    ["the knees never seen in the rep", (t, _p, b) => (b.kneesSeen = !(t > 1400 && t < 3700)), ["unseen", "knees bent"]],
  ];

  it("a slow dip with the legs within 20 degrees of straight never becomes the new standing: no count, no word", () => {
    expect(run((_t, p, b) => ((b.hips = 1.15 - 0.1 * p), (b.knee = 175 - 10 * p), (b.hipAngle = b.knee - 8)))).toEqual([["other", "depth"]]);
  });

  it.each(cases)("%s", (_name, change, verdict) => {
    expect(change === "fast" ? run(undefined, true) : run(change)).toEqual([verdict]);
  });
});

// 52a-ii-b-i: the phone on the floor. Near the floor the model's foot points wander while the feet stay where they are; a
// man's own squats, done properly, were refused for it. Each case is a properly done rep whose foot points do what his
// did, which must count; and the movements the feet's rules are there for, which still must not.
describe("the feet's rules read the feet, not the foot points' wander", () => {
  const HEELS = [KP.left_heel, KP.right_heel];
  const TOES = [KP.left_foot_index, KP.right_foot_index];
  const LEFT = [KP.left_heel, KP.left_foot_index];
  const RIGHT = [KP.right_heel, KP.right_foot_index];
  const move = (b: Body, points: readonly number[], dx: number, dy: number): void => {
    for (const i of points) b.each.set(i, [dx * SIZE, dy * SIZE]);
  };

  it("the heels and toes slide 5 cm down the picture together on the way down and up, the feet never moving: counted", () => {
    // A foot point rests where it was lowest, but never more than FOOT_ROOM under where the foot stands (52a-ii-b-i's floor
    // video: 4 to 5 cm).
    expect(run((_t, p, b) => (b.feetY = p > 0.3 && p < 0.8 ? 0.05 * SIZE : 0))).toEqual([["counted", null]]);
  });

  it("the toe points slide 9 cm down and the heel points rise 5 cm at the bottom, as on a shiny floor's reflection: counted", () => {
    expect(
      run((_t, p, b) => {
        if (p < 0.6) return;
        move(b, TOES, 0, 0.09);
        move(b, HEELS, 0, -0.05);
      }),
    ).toEqual([["counted", null]]);
  });

  it("the far foot, hidden as the rep begins, shows for a moment 29 cm from where it stood: it decides nothing; counted", () => {
    expect(
      run((t, _p, b) => {
        if (t >= 1500 && t < 2300) for (const i of RIGHT) b.each.set(i, "hidden");
        else if (t >= 2300 && t < 2500) move(b, RIGHT, 0.29, -0.1);
      }),
    ).toEqual([["counted", null]]);
  });

  it("one foot steps 15 cm in the moment after the rep is back up, as a person turns to the phone: the rep was done, counted", () => {
    expect(
      run((t, _p, b) => {
        if (t > 3650) move(b, LEFT, 0.15, 0);
      }),
    ).toEqual([["counted", null]]);
  });

  it("both feet jump 12 cm apart in the moment after the rep is back up, as a squat jack lands wide: not this movement", () => {
    expect(
      run((t, _p, b) => {
        if (t <= 3650) return;
        move(b, LEFT, 0.12, 0);
        move(b, RIGHT, -0.12, 0);
      }),
    ).toEqual([["other", "feet stay in place"]]);
  });

  it("one foot steps 12 cm during the rep: not this movement, as before", () => {
    expect(
      run((_t, p, b) => {
        if (p > 0.5) move(b, LEFT, 0.12, 0);
      }),
    ).toEqual([["other", "feet stay in place"]]);
  });
});

describe("a movement file the engine cannot use rightly is refused before it is trusted", () => {
  const withRule = (i: number, edit: Record<string, unknown>) => ({ ...SQUAT, rules: SQUAT.rules.map((r, k) => (k === i ? { ...r, ...edit } : r)) });
  const at = (name: string): number => SQUAT.rules.findIndex((r) => r.name === name);

  it("refuses a rule name that is not plain letters, digits and spaces (a __proto__ rule would never fail)", () => {
    expect(movementSchema.safeParse(withRule(at("chest up"), { name: "__proto__" })).success).toBe(false);
    expect(movementSchema.safeParse(withRule(at("chest up"), { name: "constructor" })).success).toBe(true);
  });

  it("refuses a depth of 0 or less, and a second count rule on the drive", () => {
    expect(movementSchema.safeParse(withRule(at("depth"), { atLeast: 0 })).success).toBe(false);
    expect(movementSchema.safeParse(withRule(at("depth"), { atLeast: -1 })).success).toBe(false);
    const depth = SQUAT.rules[at("depth")];
    expect(movementSchema.safeParse({ ...SQUAT, rules: [...SQUAT.rules, { ...depth, name: "depth again" }] }).success).toBe(false);
  });

  it("refuses a time read at the bottom", () => {
    const pace = { name: "pace", role: "match", at: "bottom", read: { kind: "time" }, atLeast: 0.3, seen: "always", from: "a test of the file's shape" };
    expect(movementSchema.safeParse({ ...SQUAT, rules: [...SQUAT.rules, pace] }).success).toBe(false);
    expect(movementSchema.safeParse({ ...SQUAT, rules: [...SQUAT.rules, { ...pace, at: "rep" }] }).success).toBe(true);
  });

  it("refuses a drive or a rise on anything but a height, and apart on anything but left against right", () => {
    expect(() => parseMovement({ ...SQUAT, drive: { measure: "left knee", toward: "lower" } })).toThrow(/not a height/);
    expect(() => parseMovement(withRule(at("chest up"), { read: { kind: "rise", measures: ["left knee"] } }))).toThrow(/not a height/);
    expect(() => parseMovement(withRule(at("hips alike"), { read: { kind: "apart", measure: "trunk lean" } }))).toThrow(/not left against right/);
    expect(() => parseMovement(SQUAT)).not.toThrow();
  });
});
