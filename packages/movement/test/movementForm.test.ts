// The form check (ROADMAP 52b-ii-a; spec Part 2 §12.5 "As built, the form check"). The worst thing this job could do to a
// person: they squat properly and are told to change their form. So the first test is every good-form squat set from
// outside the code (the eight people's web videos, the squat's twins, a man's own sets from the floor and a raised phone),
// as filmed, with every person's numbers and with their own left out of them, and the phone's own runs of the same
// pictures: no mistake is marked on any. Under every replay of the world, and the mistakes drawn onto real squats, are the
// proof file's (movementFormProof.test.ts). Then the judge itself, case by case, and the files it refuses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkedMistakeSchema, exerciseCameraSchema, exerciseFileSchema, mistakeMark, type CheckedMistake } from "@app/shared";
import { FORM_SEEN_FOR, MATCH_LIMITS, checkedOf, formOf, parseExercise, type FormFrame } from "../src/index.js";
import { formRows } from "../scripts/formCheck.js";
import { proofVideos, readExercise, readMovement, runMovement } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";
import { CHOSEN_RUN, pairedMarks, phoneTable } from "../scripts/phoneCounts.js";

const SQUAT = readMovement("squat");
const EXERCISE = readExercise("squat");
const VIDEOS = proofVideos();

describe("the worst thing: nobody squatting properly is told to change their form", () => {
  const rows = formRows(SQUAT, EXERCISE, [], VIDEOS);

  it("every good-form squat set is tried, as filmed, and each that sets numbers with its person left out too", () => {
    expect(rows.filter((r) => !r.leftOut).length).toBe(23);
    expect(rows.filter((r) => r.leftOut).length).toBe(17);
  });

  it.each(rows.map((r) => [`${r.label}${r.leftOut ? ", its person left out" : ""}`, r] as const))("%s: no mistake is marked, and nobody is told to keep the chest up", (_label, r) => {
    expect(r.made).toEqual([]);
    expect(r.told).toEqual([]);
  });

  it("52b-ii-b's worst thing: on no video Kd's folders hold, as filmed, is any rep told \"Keep your chest up.\"", () => {
    // 122 since 52c-ii, its 21 videos of floor work and holds (101 since 52c-i: a man's rooftop lunges are two takes joined by a
    // fade, each a set of its own).
    expect(VIDEOS.length).toBe(122);
    const told = VIDEOS.flatMap((v) => runMovement(SQUAT, v.video, EXERCISE).reps.filter((r) => r.verdict === "refused").map((r) => `${v.video.label} ${((r.start - 1000) / 1000).toFixed(1)} s`));
    expect(told).toEqual([]);
  });

  it("the phone's own runs of the same pictures mark no mistake either, and mark what the laptop marks", () => {
    const entries = MOVEMENT_VIDEOS.filter((e) => e.movement === "squat" && e.reps !== null && e.open === undefined);
    const phone = phoneTable(SQUAT, entries, CHOSEN_RUN, EXERCISE);
    expect(phone.length).toBe(23);
    const made = phone.flatMap((r) => (r.phone?.reps ?? []).flatMap((x) => x.form.filter((f) => f.status === "made").map((f) => `${r.label}: ${f.mistake}`)));
    expect(made).toEqual([]);
    expect(phone.flatMap((r) => r.why.filter((w) => w.includes("marks")))).toEqual([]);
    // Each counted rep is paired with the phone's by when it was, the three sets the phone counts one fewer on too.
    const counted = (reps: readonly { verdict: string }[]): number => reps.filter((x) => x.verdict === "counted").length;
    const unpaired = phone.filter((r) => r.phone === null || pairedMarks(r.laptop, r.phone).length !== Math.min(counted(r.laptop.reps), counted(r.phone.reps)));
    expect(unpaired.map((r) => r.label)).toEqual([]);
    const pairs = phone.flatMap((r) => (r.phone === null ? [] : pairedMarks(r.laptop, r.phone)));
    expect(pairs.length).toBeGreaterThan(50);
    expect(pairs.filter((p) => p.laptop !== p.phone)).toEqual([]);
  });
});

describe("a mistake is judged only inside a counted rep", () => {
  it("every other movement counts 0, and none of its dips carries a form check", () => {
    const others = VIDEOS.filter((v) => v.entry.movement !== "squat");
    expect(others.length).toBeGreaterThan(50);
    for (const v of others) {
      const run = runMovement(SQUAT, v.video, EXERCISE);
      if (v.entry.open === undefined) expect(run.count, v.video.label).toBe(0);
      expect(run.reps.filter((r) => r.verdict !== "counted" && r.form.length > 0), v.video.label).toEqual([]);
    }
  });

  it("a counted rep carries each checked mistake in the file's order; without an exercise, none", () => {
    const v = VIDEOS.find((x) => x.video.label === "squat_reference");
    if (v === undefined) throw new Error("no squat_reference");
    const run = runMovement(SQUAT, v.video, EXERCISE);
    expect(run.count).toBe(3);
    for (const r of run.reps.filter((x) => x.verdict === "counted")) {
      expect(r.form.map((f) => f.mistake)).toEqual(["lean_forward", "knees_cave_in"]);
      // Side on: the lean is read, the knees' width across the body is not.
      expect(r.form.map((f) => f.status)).toEqual(["fine", "unseen"]);
    }
    expect(runMovement(SQUAT, v.video).reps.every((r) => r.form.length === 0)).toBe(true);
  });

  it.each(["prisoner_squat_1", "prisoner_squat_2", "prisoner_squat_3", "prisoner_squat_4", "sumo_squat_2a", "sumo_squat_2b"])(
    "%s, facing the phone or half turned: the lean forward is never read there",
    (label) => {
      const v = VIDEOS.find((x) => x.video.label === label);
      if (v === undefined) throw new Error(`no ${label}`);
      const counted = runMovement(SQUAT, v.video, EXERCISE).reps.filter((r) => r.verdict === "counted");
      expect(counted.length).toBe(v.entry.reps);
      expect(counted.map((r) => r.form.find((f) => f.mistake === "lean_forward")?.status)).toEqual(counted.map(() => "unseen"));
    },
  );
});

describe("the squat's camera file lists every common mistake of its research file, each marked", () => {
  it("the research file's eleven, and the Library's feet that shift, each checked, left to the counting, or not", () => {
    // Kd's research file, "Normal Squat (Bodyweight Squat) Guide", its common mistakes in its own order, and the
    // Library's squat file's (ACE) one the research file does not name.
    const research = [
      "Knees caving inward",
      "Heels lifting",
      "Rounding the lower back",
      "Leaning too far forward",
      "Knees shooting far forward with the hips staying high",
      "Hips rising before the chest",
      "Quarter reps",
      "Feet too narrow or too wide",
      "Bouncing out of the bottom",
      "Locking the knees hard at the top",
      "Holding your breath for the whole rep",
      "Feet shifting during the set",
    ];
    expect([...EXERCISE.mistakes.map((m) => m.name)].sort()).toEqual([...research].sort());
    expect(Object.fromEntries(EXERCISE.mistakes.map((m) => [m.id, m.camera]))).toEqual({
      lean_forward: "checked",
      hips_rise_first: "not checked",
      knees_forward: "not checked",
      knees_cave_in: "checked",
      quarter_reps: "counting",
      feet_move: "counting",
      heels_lift: "cannot see",
      bounce: "cannot see",
      back_rounds: "cannot see",
      knees_lock: "cannot see",
      breath_held: "cannot see",
      stance_width: "not checked",
    });
    // The two marks a member sees beside them (Kd, 2026-11-23): checked by the camera, or not.
    expect(EXERCISE.mistakes.filter((m) => mistakeMark(m) === "Checked by the camera").map((m) => m.id)).toEqual(["lean_forward", "knees_cave_in", "quarter_reps", "feet_move"]);
    expect(EXERCISE.mistakes.filter((m) => mistakeMark(m) === "Not checked by the camera").length).toBe(8);
    // Every mistake the Library's squat file names is in the camera file under the same id (spec §13.3).
    const library = exerciseFileSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "../../shared/library/exercises/squat.json"), "utf8")));
    const ids = library.text.en.mistakes.map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !EXERCISE.mistakes.some((m) => m.id === id))).toEqual([]);
  });
});

// ── The judge, case by case (a rule that thresholds: every class of case, CLAUDE.md §4) ─────────────────────────────
/** A checked mistake, a lean read side on at the bottom with a line of at most 40 unless `over` says otherwise; `lower`
 *  gives it a line of at least `lower` instead. */
const mistake = (over: Record<string, unknown>, lower?: number): CheckedMistake =>
  checkedMistakeSchema.parse({
    id: "m",
    name: "A mistake",
    source: "test",
    camera: "checked",
    read: { kind: "value", measures: ["trunk lean"] },
    at: "bottom",
    view: "side",
    against: "nothing",
    ...(lower === undefined ? { atMost: 40 } : { atLeast: lower }),
    coach: { silent: "test" },
    from: "test",
    ...over,
  });

/** A rep at 30 frames a second: down for 1 s to a drop of 0.5, 0.3 s at the bottom, up for 1 s; `v` gives each frame's
 *  reading from its time (ms) and drop; `turn`, how much of the body's line across the picture shows (0 side on). */
function rep(v: (t: number, drop: number) => number | null, turn: number | null = 0): FormFrame[] {
  const out: FormFrame[] = [];
  for (let t = 0; t <= 2300; t += 1000 / 30) {
    const drop = t < 1000 ? 0.5 * (t / 1000) : t <= 1300 ? 0.5 : 0.5 * Math.max(0, 1 - (t - 1300) / 1000);
    out.push({ t, drop, form: [v(t, drop)], turn });
  }
  return out;
}
/** A width across the body, read facing the phone. */
const across = { view: "front", read: { kind: "value", measures: ["knees apart"] } };
const judge = (m: CheckedMistake, frames: readonly FormFrame[], standing: number | null = null) => formOf(m, 0, frames, standing, MATCH_LIMITS.bottomBand, 100);

describe("the judge", () => {
  it.each([
    ["at the bottom, past its line: made", mistake({}), rep((_t, d) => (d >= 0.45 ? 45 : 20)), null, "made", 45],
    ["at the bottom, at its line exactly: fine", mistake({}), rep((_t, d) => (d >= 0.45 ? 40 : 0)), null, "fine", 40],
    ["at the bottom, a lower line passed: made", mistake({}, 10), rep(() => 5), null, "made", 5],
    ["past the line only on the way down, not at the bottom: fine", mistake({}), rep((t) => (t < 900 ? 60 : 30)), null, "fine", 30],
    ["seen in fewer than half the bottom's frames: unseen", mistake({}), rep((t) => (t >= 900 && t < 1300 ? null : 50)), null, "unseen", null],
    ["seen in half the bottom's frames or more: judged", mistake({}), rep((t) => (t >= 1000 && t < 1100 ? null : 50)), null, "made", 50],
    ["against standing: the change from it", mistake({ ...across, against: "standing" }, -0.1), rep(() => 0.2, 1), 0.35, "made", -0.15],
    ["against standing, never stood ready seen: unseen", mistake({ ...across, against: "standing" }), rep(() => 0.2, 1), null, "unseen", null],
    ["side on but turned, inside its line yet truly past it at that turn: unseen", mistake({}), rep(() => 38, 0.5), null, "unseen", 38],
    ["side on but turned, inside its line even at its truest: fine", mistake({}), rep(() => 35, 0.5), null, "fine", 35],
    ["side on but turned, past its line: made", mistake({}), rep(() => 41, 0.5), null, "made", 41],
    ["facing the phone half turned, a width inside its line yet truly past it: unseen", mistake({ ...across, against: "standing" }, -0.06), rep(() => 0.25, 0.7), 0.3, "unseen", -0.05],
    ["facing the phone square on, the same width: fine", mistake({ ...across, against: "standing" }, -0.06), rep(() => 0.25, 1), 0.3, "fine", -0.05],
    ["the body's turn not seen: unseen, however far inside its line", mistake({}), rep(() => 10, null), null, "unseen", 10],
    ["no drop seen at all: unseen", mistake({}), rep(() => 50).map((f) => ({ ...f, drop: null })), null, "unseen", null],
    ["on the way up, the chest falling forward out of the bottom: made", mistake({ at: "way up", against: "bottom", atMost: 10 }), rep((t) => (t > 1450 && t < 1700 ? 45 : 30)), null, "made", 15],
    ["on the way up, rising together: fine", mistake({ at: "way up", against: "bottom", atMost: 10 }), rep((_t, d) => (d >= 0.45 ? 30 : 10 + 40 * d)), null, "fine", 0],
    ["on the way up, a lean past half way up is not read", mistake({ at: "way up", against: "bottom", atMost: 10 }), rep((t) => (t > 2000 ? 60 : 30)), null, "fine", 0],
    ["on the way up, broken off longer than a break: unseen", mistake({ at: "way up", against: "bottom", atMost: 10 }), rep((t) => (t > 1450 && t < 1600 ? null : 30)), null, "unseen", null],
    ["over the rep, its furthest wherever seen: made", mistake({ ...across, at: "rep", against: "standing" }, -0.1), rep((t) => (t > 1000 && t < 1300 ? null : t > 1500 && t < 1600 ? 0.1 : 0.3), 1), 0.3, "made", -0.2],
    ["over the rep, seen too briefly: unseen", mistake({ ...across, at: "rep", against: "standing" }, -0.1), rep((t) => (t < FORM_SEEN_FOR - 50 ? 0.1 : null), 1), 0.3, "unseen", null],
  ])("%s", (_name, m, frames, standing, status, reading) => {
    const got = judge(m, frames, standing);
    expect(got.status).toBe(status);
    if (reading === null) expect(got.reading).toBeNull();
    else expect(got.reading).toBeCloseTo(reading, 6);
  });
});

// ── A camera file the engine cannot read rightly is refused ───────────────────────────────────────────────────────
describe("a camera file the engine cannot read rightly is refused", () => {
  const json = exerciseCameraSchema.parse(JSON.parse(JSON.stringify(EXERCISE)));
  const lean = (over: Record<string, unknown>): unknown => ({ ...json, mistakes: json.mistakes.map((m) => (m.id === "lean_forward" ? { ...m, ...over } : m)) });

  it("the squat's own file is read", () => {
    expect(parseExercise(json, SQUAT).id).toBe("squat");
    expect(checkedOf(EXERCISE).map((m) => m.id)).toEqual(["lean_forward", "knees_cave_in"]);
  });

  it.each([
    ["a mistake with two lines", lean({ atLeast: 10 })],
    ["a mistake with no line", lean({ atMost: undefined })],
    ["a reading on the way up not taken against the bottom", lean({ at: "way up" })],
    ["a reading at the bottom taken against the bottom", lean({ against: "bottom" })],
    ["a mistake read from no view", lean({ view: undefined })],
    ["a mistake read from any view", lean({ view: "any" })],
    ["a name that is a sentence", lean({ name: "Leaning too far forward." })],
    ["refused words that are not a sentence", lean({ refused: { rule: "chest up", words: "keep your chest up" } })],
    ["refused with no words", lean({ refused: { rule: "chest up" } })],
    ["a file with no version", { ...json, version: undefined }],
    ["a file at version 0", { ...json, version: 0 }],
    ["two mistakes with one id", { ...json, mistakes: [...json.mistakes, json.mistakes[0]] }],
    ["a status nobody knows", lean({ camera: "maybe" })],
  ])("%s", (_name, bad) => {
    expect(exerciseCameraSchema.safeParse(bad).success).toBe(false);
  });

  it.each([
    ["a measure the engine does not have", lean({ read: { kind: "value", measures: ["spine curve"] } }), /spine curve/],
    ["a mistake left to a rule the movement does not have", { ...json, mistakes: json.mistakes.map((m) => (m.id === "quarter_reps" ? { ...m, rule: "depth of soul" } : m)) }, /depth of soul/],
    ["a file on another movement", { ...json, movement: "lunge" }, /lunge/],
    ["a width read side on", lean({ read: { kind: "value", measures: ["knees apart"] } }), /side on/],
    ["a lean read side on against standing", lean({ against: "standing" }), /side on/],
    ["a lean read facing the phone", lean({ view: "front" }), /facing the phone/],
    ["refused by a rule the movement does not have", lean({ refused: { rule: "chest down", words: "Keep your chest up." } }), /chest down/],
    ["refused by a count rule", lean({ refused: { rule: "knees bent", words: "Keep your chest up." } }), /must be a match rule/],
    ["refused by a rule that reads another measure", lean({ refused: { rule: "hips and knees together", words: "Keep your chest up." } }), /must be a match rule/],
    ["refused by a rule nearer than the mistake's own line", lean({ atMost: 55 }), /must be a match rule/],
    ["two mistakes refused by one rule", { ...json, mistakes: [...json.mistakes, { ...json.mistakes[0], id: "lean_again" }] }, /two mistakes are refused by "chest up"/],
  ])("%s", (_name, bad, message) => {
    expect(() => parseExercise(bad, SQUAT)).toThrow(message);
  });
});
