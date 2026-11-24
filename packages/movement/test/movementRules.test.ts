// Every rule of the squat, one at a time (ROADMAP 52a-i, round one): a squat rep made by hand from measures, which
// counts, then the same rep with exactly one thing changed, which each rule alone must refuse, by its own name and in
// its own way ("short" with its reason for how far, silence for what kind, nothing decided for what was not seen).
// A table over every class of case, as CLAUDE.md §4 asks of a rule that thresholds.
import { describe, expect, it } from "vitest";
import { engineSetSummarySchema, movementSchema, type ExerciseCamera } from "@app/shared";
import { KP } from "@app/shared";
import { MATCH_LIMITS, MEASURE_LIST, MovementMatcher, SetRecord, parseMovement, type MeasureName, type MeasuredBody, type Reading, type SteadyBody, type SteadyPoint } from "../src/index.js";
import { readExercise, readMovement } from "../scripts/movementCheck.js";

const SQUAT = readMovement("squat");
const EXERCISE = readExercise("squat", SQUAT);
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
  /** Knees read at all; the right knee alone hidden. */
  kneesSeen: boolean;
  rightKneeHidden: boolean;
  /** For one foot point, how far it alone is moved on the picture (picture heights), or "hidden". */
  each: Map<number, readonly [number, number] | "hidden">;
  /** How much of the hips' line the picture shows (form.ts `turnOf`): 0.3, side on; 1, facing the phone. */
  turn: number;
  /** The hips' height read at all. */
  hipsSeen: boolean;
}
type Change = (t: number, p: number, b: Body) => void;

const ASPECT = 9 / 16;
const SIZE = 0.5;
const FEET: readonly number[] = [KP.left_heel, KP.left_foot_index, KP.right_heel, KP.right_foot_index];

/** A rep made by hand at 30 frames a second for 5 s, changed by `change`, run through the matcher: each judged rep's
 *  verdict and rule. */
function run(change?: Change, fast = false) {
  return repsOf(change, fast).map((r) => [r.verdict, r.rule]);
}

/** The same rep's judged reps, whole; with `exercise`, its mistakes judged too. Every frame is also given to a set's
 *  record (`SetRecord`), returned beside them. `two`: the same rep again 4 s later (`SECOND`), the set 9 s long. */
function repsOf(change?: Change, fast = false, exercise: ExerciseCamera | null = null, two = false) {
  return recorded(change, fast, exercise, two).reps;
}

/** When a set of two reps' second rep begins its moment of standing, ms. */
const SECOND = 4000;

function recorded(change?: Change, fast = false, exercise: ExerciseCamera | null = null, two = false) {
  const m = new MovementMatcher(SQUAT, MATCH_LIMITS, exercise);
  const record = new SetRecord(exercise ?? EXERCISE, SQUAT, 1);
  const reps = [];
  for (let n = 0; n * (1000 / 30) <= (two ? 9000 : 5000); n++) {
    const t = Math.round((n * 1000 * 10) / 30) / 10;
    const p = two && t > SECOND ? depthAt(t - SECOND, fast) : depthAt(t, fast);
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
      rightKneeHidden: false,
      each: new Map(),
      turn: 0.3,
      hipsSeen: true,
    };
    change?.(t, p, b);
    const value = new Map<string, number | null>([
      ["hips height", b.hipsSeen ? b.hips : null],
      ["left knee", b.kneesSeen ? b.knee : null],
      ["right knee", b.kneesSeen && !b.rightKneeHidden ? b.knee : null],
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
        // The hips' line across the picture, shown as much as the body is turned to the phone (form.ts `turnOf`).
        if (name === "hips apart") return [name, { flat: 0.4 * b.turn, world: 0.4, shown: b.turn, off: 0 }];
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
    record.add(f);
    if (f.rep !== null) reps.push(f.rep);
  }
  const last = m.finish();
  if (last !== null) record.add(last);
  if (last?.rep) reps.push(last.rep);
  return { reps, record };
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

// 52b-i: what the screen says about a rep not counted, and what the camera saw deciding before what it did not.
describe("each rep not counted says why in the movement's own words, and what was seen decides first", () => {
  const HIDE_FEET: Change = (t, _p, b) => {
    if (t > 1400 && t < 3700) for (const i of FEET) b.each.set(i, "hidden");
  };
  const both = (...changes: Change[]): Change => (t, p, b) => {
    for (const c of changes) c(t, p, b);
  };
  const said = (change?: Change) => repsOf(change).map((r) => [r.verdict, r.rule, r.reason]);

  const SAID: readonly (readonly [string, Change | undefined, readonly [string, string | null, string | null]])[] = [
    ["counted: nothing to say", undefined, ["counted", null, null]],
    ["the hips not deep enough: go lower", (_t, p, b) => (b.hips = 1.15 - bound("depth") * 0.8 * p), ["short", "depth", "Go lower to count."]],
    ["the knees not bent enough: go lower", (_t, p, b) => ((b.knee = 175 - (175 - bound("knees bent") - 12) * p), (b.hipAngle = b.knee - 8)), ["short", "knees bent", "Go lower to count."]],
    ["the feet hidden all through a good rep: keep the whole body in view (a passer-by hides more than the feet)", HIDE_FEET, ["unseen", "feet stay down", "Keep your whole body in view."]],
    ["the knees hidden all through a good rep: keep the whole body in view", (t, _p, b) => (b.kneesSeen = !(t > 1400 && t < 3700)), ["unseen", "knees bent", "Keep your whole body in view."]],
    ["a deadlift (the hips bend far more than the knees): nothing", (_t, p, b) => (b.hipAngle = 168 - (85 + bound("hips and knees together") + 15) * p), ["other", "hips and knees together", null]],
  ];

  it.each(SAID)("%s", (_name, change, verdict) => {
    expect(said(change)).toEqual([verdict]);
  });

  it("a deadlift whose feet are hidden all through is another movement, silent: never told the camera could not see the feet", () => {
    const deadlift: Change = (_t, p, b) => (b.hipAngle = 168 - (85 + bound("hips and knees together") + 15) * p);
    expect(said(both(deadlift, HIDE_FEET))).toEqual([["other", "hips and knees together", null]]);
  });

  it("a dip that never tried, its feet hidden all through, is another movement, silent", () => {
    const barely: Change = (_t, p, b) => ((b.hips = 1.15 - (bound("depth") + 0.05) * p), (b.knee = 175 - 30 * p), (b.hipAngle = b.knee - 8));
    expect(said(both(barely, HIDE_FEET))).toEqual([["other", "knees bent", null]]);
  });

  it("a rep that falls short with its feet hidden is not told to go lower: what the camera could not see leaves it undecided", () => {
    const shallow: Change = (_t, p, b) => ((b.knee = 175 - (175 - bound("knees bent") - 12) * p), (b.hipAngle = b.knee - 8));
    expect(said(both(shallow, HIDE_FEET))).toEqual([["unseen", "feet stay down", "Keep your whole body in view."]]);
  });

  it("back up once standing tall, however low the hips read against the first standing: the rep counts", () => {
    // After the rep the hips read 0.09 of a leg under where she first stood, the knees straight and the trunk upright,
    // as the plate goblet squat's did between her third and fourth reps: never back by the hips alone (within 0.08).
    expect(run((t, p, b) => (b.hips = 1.15 - 0.45 * p - (t > 2800 ? 0.09 : 0)))).toEqual([["counted", null]]);
  });

  it("never back up on one knee alone: the other hidden, a straight knee in view is not standing tall", () => {
    // The same lower hips after the rep, and the right knee hidden once he is up: not back, so nothing is judged (a
    // passer-by hiding a lunge's front leg left its straight back knee alone in view).
    const oneKnee: Change = (t, p, b) => {
      b.hips = 1.15 - 0.45 * p - (t > 2800 ? 0.09 : 0);
      if (t > 3300) b.rightKneeHidden = true;
    };
    expect(run(oneKnee)).toEqual([]);
  });
});

// 52b-ii-b, Kd's ruling of 2026-11-23: a squat leaning past "chest up" is still not counted, and is told "Keep your chest
// up." when it is a squat in every other way; never another movement's dip. Every class of case, the squat's camera file
// given: the worst thing is the word said where it does not belong, so most cases here are the silent ones.
describe("a squat whose chest leans past chest up is told to keep it up, and nothing else ever is", () => {
  // Each case is the second rep of a set whose first rep was a proper squat, counted: the words are said only once the set
  // has counted a rep of the squat (round one: a kettlebell swing's first dip under the floor view).
  const second = (change: Change): Change => (t, p, b) => {
    if (t > SECOND) change(t - SECOND, p, b);
  };
  const leanTo = (degrees: number): Change => (_t, p, b) => (b.trunk = 3 + (degrees - 3) * p);
  const past = bound("chest up") + 6;
  const both = (...changes: Change[]): Change => (t, p, b) => {
    for (const c of changes) c(t, p, b);
  };
  const saidAll = (change: Change, exercise: ExerciseCamera | null = EXERCISE) => repsOf(second(change), false, exercise, true).map((r) => [r.verdict, r.rule, r.reason]);
  const said = (change: Change, exercise: ExerciseCamera | null = EXERCISE) => {
    const all = saidAll(change, exercise);
    expect(all[0]).toEqual(["counted", null, null]);
    return all.slice(1);
  };
  const HIDE_FEET: Change = (t, _p, b) => {
    if (t > 1400 && t < 3700) for (const i of FEET) b.each.set(i, "hidden");
  };

  it("the first rep of a set, leaning past chest up, is not counted and says nothing: no squat counted yet", () => {
    expect(repsOf(leanTo(past), false, EXERCISE).map((r) => [r.verdict, r.rule, r.reason])).toEqual([["other", "chest up", null]]);
  });

  it("the file's own line: the squat's chest up is 52 degrees, its lean forward 46", () => {
    expect([bound("chest up"), EXERCISE.mistakes.find((m) => m.id === "lean_forward")]).toMatchObject([52, { atMost: 46, refused: { rule: "chest up", words: "Keep your chest up." } }]);
  });

  const CASES: readonly (readonly [string, Change, readonly [string, string | null, string | null]])[] = [
    ["side on, a squat in every way but the chest, leaning past chest up: not counted, told to keep the chest up", leanTo(past), ["refused", "chest up", "Keep your chest up."]],
    ["the same, facing the phone: the picture cannot see a lean from the front, so silent", both(leanTo(past), (_t, _p, b) => (b.turn = 1)), ["other", "chest up", null]],
    ["the same, half turned (0.6 of the hips shown): not side on, silent", both(leanTo(past), (_t, _p, b) => (b.turn = 0.6)), ["other", "chest up", null]],
    ["the same, the hips also short of the depth: not a squat in every other way, silent", both(leanTo(past), (_t, p, b) => (b.hips = 1.15 - bound("depth") * 0.8 * p)), ["other", "chest up", null]],
    ["the same, the hips also bending far more than the knees (a hinge): silent", both(leanTo(past), (_t, p, b) => (b.hipAngle = 168 - (85 + bound("hips and knees together") + 15) * p)), ["other", "hips and knees together", null]],
    ["the same, the feet hidden all through: what the camera could not see leaves it silent", both(leanTo(past), HIDE_FEET), ["other", "chest up", null]],
    ["the same, the feet stepping out at the bottom: silent", both(leanTo(past), (_t, p, b) => (b.feetX = p > 0.5 ? (bound("feet stay in place") + 0.05) * SIZE : 0)), ["other", "chest up", null]],
    ["a lean past leaning too far forward and short of chest up: counted", leanTo(49), ["counted", null, null]],
    ["a lean just at chest up: counted", leanTo(bound("chest up")), ["counted", null, null]],
  ];

  it.each(CASES)("%s", (_name, change, verdict) => {
    expect(said(change)).toEqual([verdict]);
  });

  it("the told rep carries the mistake that refused it, made; the rep counted at 49 degrees is marked leaning too far forward", () => {
    expect(repsOf(second(leanTo(past)), false, EXERCISE, true).map((r) => r.form.map((f) => [f.mistake, f.status]))[1]).toEqual([["lean_forward", "made"]]);
    expect(repsOf(leanTo(49), false, EXERCISE).map((r) => r.form.map((f) => [f.mistake, f.status]))).toEqual([[["lean_forward", "made"], ["knees_cave_in", "unseen"]]]);
  });

  it("without the exercise's camera file the movement alone never speaks of the chest", () => {
    expect(said(leanTo(past), null)).toEqual([["other", "chest up", null]]);
  });
});

describe("the set's summary of the rep made by hand passes the server's own check", () => {
  const summaryOf = (change?: Change) => engineSetSummarySchema.parse(recorded(change, false, EXERCISE).record.summary());

  it("a good rep, side on: one rep scored 100, nothing made, the whole 5 s watched", () => {
    const s = summaryOf();
    expect(s).toMatchObject({ exercise: "squat", setIndex: 1, reps: 1, repScores: [100], avgFormScore: 100, view: "side", mode: "engine", engineVersion: "2.0.0", definitionVersion: EXERCISE.version });
    // A partial match takes {} for any faults: compared whole.
    expect(s.faultCounts).toEqual({});
    expect([s.durationMs, s.watchedMs]).toEqual([5000, 5000]);
    expect(s.romStats).toEqual({ depth: 0.45, "knees bent": 90 });
  });

  it("leaning too far forward on its one rep: scored 0, the mistake counted once", () => {
    const s = summaryOf((_t, p, b) => (b.trunk = 3 + 46 * p));
    expect(s).toMatchObject({ reps: 1, repScores: [0], avgFormScore: 0 });
    expect(s.faultCounts).toEqual({ lean_forward: 1 });
  });

  it("a good rep, then one refused for its chest: one rep, one score, and the mistake counted", () => {
    const lean: Change = (t, p, b) => (b.trunk = t > SECOND ? 3 + (bound("chest up") + 3) * p : b.trunk);
    const s = engineSetSummarySchema.parse(recorded(lean, false, EXERCISE, true).record.summary());
    expect(s).toMatchObject({ reps: 1, repScores: [100], avgFormScore: 100, view: "side" });
    expect(s.faultCounts).toEqual({ lean_forward: 1 });
  });

  it("the first rep refused for its chest, so only silent: no rep, no score and no mistake counted", () => {
    const s = summaryOf((_t, p, b) => (b.trunk = 3 + (bound("chest up") + 3) * p));
    expect(s).toMatchObject({ reps: 0, repScores: [], avgFormScore: null, tempoMsAvg: null, romStats: null, view: "unknown" });
    expect(s.faultCounts).toEqual({});
  });

  it("facing the phone, the camera seeing none of the mistakes: the rep counts and has no score, never a good one", () => {
    const s = summaryOf((_t, _p, b) => (b.turn = 1));
    expect(s).toMatchObject({ reps: 1, repScores: [], avgFormScore: null, view: "front" });
    expect(s.faultCounts).toEqual({});
  });

  it("the person lost from view for 0.47 s after the rep: that time is not watched", () => {
    const s = summaryOf((t, _p, b) => (b.hipsSeen = !(t > 4000 && t < 4500)));
    expect(s.reps).toBe(1);
    expect(s.durationMs - (s.watchedMs ?? 0)).toBe(467);
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

  it("refuses a rule without its words for the screen, or with words it can never say, and a standard on a match rule", () => {
    const depth = SQUAT.rules[at("depth")];
    const chest = SQUAT.rules[at("chest up")];
    expect(movementSchema.safeParse(withRule(at("depth"), { short: undefined })).success).toBe(false);
    expect(movementSchema.safeParse(withRule(at("chest up"), { short: "Go lower to count." })).success).toBe(false);
    expect(movementSchema.safeParse(withRule(at("chest up"), { unseen: undefined })).success).toBe(false);
    expect(movementSchema.safeParse(withRule(at("hips alike"), { unseen: "Keep your whole body in view." })).success).toBe(false);
    // A match rule may be set from a standard used as it is (52c-i: the squat jump's jump), never one moved by the camera's
    // room, which only makes counting forgiving.
    expect(movementSchema.safeParse(withRule(at("chest up"), { standard: SQUAT.rules[at("knees bent")]?.standard })).success).toBe(false);
    expect(movementSchema.safeParse(withRule(at("chest up"), { standard: depth?.standard })).success).toBe(true);
    expect(movementSchema.safeParse(withRule(at("depth"), { short: "go lower" })).success).toBe(false);
    expect(movementSchema.safeParse(withRule(at("depth"), { short: "Go lower.\nNow." })).success).toBe(false);
    expect([depth?.short, chest?.unseen]).toEqual(["Go lower to count.", "Keep your whole body in view."]);
  });

  it("refuses a time read at the bottom", () => {
    const pace = { name: "pace", role: "match", at: "bottom", read: { kind: "time" }, atLeast: 0.3, seen: "always", unseen: "Keep your whole body in view.", from: "a test of the file's shape" };
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
