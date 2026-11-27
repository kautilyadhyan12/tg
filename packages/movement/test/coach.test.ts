// The coach (ROADMAP 53b-i; spec Part 2 §12.6): what it says, and when. A rule that picks what is said to a person ships
// with a table over every class of case (CLAUDE.md §4). The worst thing first: a person doing it properly is never told to
// change, and another movement is never told anything.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { voiceSchema, type ExerciseCamera } from "@app/shared";
import { COACH_LIMITS, Coach, coachWords, parseExercise, type FormStatus, type HoldFrame, type RepResult, type Say } from "../src/index.js";
import { readExercise, readMovement } from "../scripts/movementCheck.js";
import { VOICE_FILE } from "../scripts/voiceLines.js";

const SQUAT = readMovement("squat");
const EXERCISE = readExercise("squat", SQUAT);
const WORDS = coachWords(voiceSchema.parse(JSON.parse(readFileSync(VOICE_FILE, "utf8"))));
const KNEES = "Keep your knees in line with your toes.";
const CHEST = "Keep your chest up.";

/** The squat's camera file with its lean spoken too, so that two spoken corrections can meet in one rep. */
const BOTH: ExerciseCamera = parseExercise(
  { ...EXERCISE, mistakes: EXERCISE.mistakes.map((m) => (m.id === "lean_forward" && m.camera === "checked" ? { ...m, coach: { words: CHEST } } : m)) },
  SQUAT,
);

let clock = 0;
/** A rep judged 3 s after the one before; `form` gives the squat's two checked mistakes in its file's order. */
function rep(verdict: RepResult["verdict"], form: { lean?: FormStatus; knees?: FormStatus } = {}, reason: string | null = null): RepResult {
  clock += 3000;
  const checks = [
    ["lean_forward", form.lean],
    ["knees_cave_in", form.knees],
  ] as const;
  return {
    start: clock - 2000,
    end: clock,
    verdict,
    rule: null,
    reason,
    readings: {},
    standing: {},
    form: verdict === "counted" ? checks.flatMap(([mistake, status]) => (status === undefined ? [] : [{ mistake, reading: status === "unseen" ? null : 1, status }])) : [],
    turn: 0.5,
    side: null,
  };
}

/** What a set says, rep by rep: each rep's line or "-". The count is the counted reps so far. */
function talk(reps: readonly RepResult[], target: number | null = null, exercise: ExerciseCamera | null = EXERCISE): string[] {
  const coach = new Coach(exercise, WORDS);
  let count = 0;
  return reps.map((r) => {
    if (r.verdict === "counted") count += 1;
    return coach.rep(r, count, target)?.words ?? "-";
  });
}

const counted = (n: number, form: { lean?: FormStatus; knees?: FormStatus } = { lean: "fine", knees: "fine" }): RepResult[] => Array.from({ length: n }, () => rep("counted", form));

describe("the worst thing: a proper set is never told to change, and another movement is never told anything", () => {
  it.each([
    ["every mistake seen and fine", { lean: "fine", knees: "fine" }],
    ["every mistake unseen from where the phone stands", { lean: "unseen", knees: "unseen" }],
    ["one fine, one unseen", { lean: "unseen", knees: "fine" }],
    ["an exercise with no camera file: no form at all", {}],
  ] as const)("%s: twelve reps with no target say nothing", (_, form) => {
    expect(talk(counted(12, form), null).filter((s) => s !== "-")).toEqual([]);
  });

  it("another movement, dip after dip, with no reason: nothing, and nothing after", () => {
    expect(talk(Array.from({ length: 10 }, () => rep("other")))).toEqual(Array<string>(10).fill("-"));
  });

  it("a mistake whose correction is silent in its camera file (the squat's lean) is never said, however often it is made", () => {
    expect(talk(counted(8, { lean: "made", knees: "fine" }))).toEqual(Array<string>(8).fill("-"));
  });

  it("a proper set with a target hears only the count", () => {
    expect(talk(counted(10), 10)).toEqual(["-", "-", "-", "-", "Halfway.", "-", "-", "Two more.", "Last one.", "-"]);
  });
});

describe("a correction: made in two counted reps running, one at a time, never twice in a row", () => {
  it.each([
    ["made once: nothing", ["made"], ["-"]],
    ["made twice running: the correction after the second", ["made", "made"], ["-", KNEES]],
    ["made, unseen, made: the unseen rep neither breaks nor adds", ["made", "unseen", "made"], ["-", "-", KNEES]],
    ["made, fine, made: fine breaks the run", ["made", "fine", "made"], ["-", "-", "-"]],
    ["made four times: said after the second and the fourth, never two reps running", ["made", "made", "made", "made"], ["-", KNEES, "-", KNEES]],
    ["corrected, then fine: \"Better.\"", ["made", "made", "fine"], ["-", KNEES, "Better."]],
    ["corrected, unseen, then fine: \"Better.\" when it is seen fine", ["made", "made", "unseen", "fine"], ["-", KNEES, "-", "Better."]],
    ["fine with nothing corrected: no praise", ["fine", "fine"], ["-", "-"]],
  ] as const)("%s", (_, knees, said) => {
    expect(talk(knees.map((k) => rep("counted", { lean: "fine", knees: k })))).toEqual(said);
  });

  it("when it comes back it is said in its next wording", () => {
    const coach = new Coach(EXERCISE, WORDS);
    const knees: FormStatus[] = ["made", "made", "fine", "made", "made"];
    const out = knees.map((k, i) => coach.rep(rep("counted", { knees: k }), i + 1, null));
    expect(out.map((s) => (s === null ? "-" : `${s.words} ${String(s.times)}`))).toEqual(["-", `${KNEES} 0`, "Better. 0", "-", `${KNEES} 1`]);
  });

  it("two mistakes due on one rep: the camera file's first, then the other on the next rep it is still made", () => {
    const reps = [rep("counted", { lean: "made", knees: "made" }), rep("counted", { lean: "made", knees: "made" }), rep("counted", { lean: "fine", knees: "made" })];
    expect(talk(reps, null, BOTH)).toEqual(["-", CHEST, KNEES]);
  });

  it("a correction outranks the count, and praise outranks it too", () => {
    const reps = [...counted(7), rep("counted", { lean: "fine", knees: "made" }), rep("counted", { lean: "fine", knees: "made" }), rep("counted", { lean: "fine", knees: "fine" })];
    expect(talk(reps, 11)).toEqual(["-", "-", "-", "-", "-", "Halfway.", "-", "-", KNEES, "Better."]);
  });
});

describe("a rep not counted: its reason in the screen's own words", () => {
  const lower = "Go lower to count.";
  const view = "Keep your whole body in view.";
  it.each([
    ["short: said on the first, every other one after", ["short", "short", "short", "short"], [lower, "-", lower, "-"]],
    ["unseen: from the second running, every other one after", ["unseen", "unseen", "unseen", "unseen"], ["-", view, "-", view]],
    ["short, then counted: \"That one counts.\"", ["short", "counted"], [lower, "That one counts."]],
    ["short, short (silent), then counted: still \"That one counts.\"", ["short", "short", "counted"], [lower, "-", "That one counts."]],
    ["unseen said, then counted: no praise, nothing was wrong with the rep", ["unseen", "unseen", "counted"], ["-", view, "-"]],
    ["a counted rep breaks the run: short again is said again", ["short", "counted", "short"], [lower, "That one counts.", lower]],
    ["another movement between two short reps leaves the run as it was", ["short", "other", "short"], [lower, "-", "-"]],
  ] as const)("%s", (_, verdicts, said) => {
    const reps = verdicts.map((v) => (v === "counted" ? rep("counted", { lean: "fine", knees: "fine" }) : v === "other" ? rep("other") : rep(v, {}, v === "short" ? lower : view)));
    expect(talk(reps)).toEqual(said);
  });

  it("a rep refused for its chest says the refusal's words, and the next counted rep \"That one counts.\"", () => {
    expect(talk([rep("refused", {}, CHEST), rep("counted", { lean: "fine", knees: "fine" })])).toEqual([CHEST, "That one counts."]);
  });
});

describe("the count against the set's target", () => {
  it.each([
    [10, ["-", "-", "-", "-", "Halfway.", "-", "-", "Two more.", "Last one.", "-"]],
    [8, ["-", "-", "-", "Halfway.", "-", "Two more.", "Last one.", "-"]],
    [7, ["-", "-", "-", "-", "Two more.", "Last one.", "-"]],
    [4, ["-", "Two more.", "Last one.", "-"]],
    [3, ["-", "Last one.", "-"]],
    [1, ["-"]],
  ] as const)("a target of %i", (target, said) => {
    expect(talk(counted(target), target)).toEqual(said);
  });

  it("the count is the one the screen shows: with a rep added by hand, \"Last one.\" comes a rep earlier", () => {
    const coach = new Coach(EXERCISE, WORDS);
    const shown = [2, 3, 4].map((c) => coach.rep(rep("counted", { lean: "fine", knees: "fine" }), c, 5)?.words ?? "-");
    expect(shown).toEqual(["-", "Two more.", "Last one."]);
  });

  it("a line that only encourages is left out within 0.8 s of the line before; a correction never is", () => {
    const coach = new Coach(EXERCISE, WORDS);
    const at = (r: RepResult, t: number): RepResult => ({ ...r, end: t });
    const said = [
      coach.rep(at(rep("counted", { knees: "made" }), 1000), 1, 4),
      coach.rep(at(rep("counted", { knees: "made" }), 2000), 2, 4),
      coach.rep(at(rep("counted", { knees: "fine" }), 2500), 3, 4),
      coach.rep(at(rep("counted", { knees: "made" }), 6000), 4, 9),
      coach.rep(at(rep("counted", { knees: "made" }), 7000), 5, 9),
    ].map((s) => s?.words ?? "-");
    expect(COACH_LIMITS.quiet).toBe(800);
    expect(said).toEqual(["-", KNEES, "-", "-", KNEES]);
  });

  it("\"Set complete.\" once, when the set ends", () => {
    const coach = new Coach(EXERCISE, WORDS);
    expect([coach.end(1000)?.words, coach.end(2000)]).toEqual(["Set complete.", null]);
  });
});

describe("the person lost", () => {
  it("said once while lost, not again within 10 s, again after", () => {
    const coach = new Coach(EXERCISE, WORDS);
    const steps: [number, boolean][] = [
      [1000, false],
      [3000, true],
      [3100, true],
      [5000, false],
      [8000, true],
      [9000, false],
      [14_000, true],
    ];
    const out = steps.map(([t, lost]) => coach.seen(t, lost));
    expect(out.map((s) => (s === null ? "-" : `${s.words} ${String(s.times)}`))).toEqual(["-", "The camera can't see you. 0", "-", "-", "-", "-", "The camera can't see you. 1"]);
  });
});

describe("a hold", () => {
  const frame = (t: number, holding: boolean, heldMs: number, unseen = false): HoldFrame => ({ t, holding, heldMs, unseen, reason: unseen ? "Keep your whole body in view." : null, hold: null });
  it("its reason once the position has been unread 2 s, and again only after it was held again; \"Halfway.\" at half its time, after the quiet", () => {
    const coach = new Coach(null, WORDS);
    const steps = [
      frame(0, true, 0),
      frame(1000, false, 1000, true),
      frame(2900, false, 1000, true),
      frame(3000, false, 1000, true),
      frame(4000, false, 1000, true),
      frame(5000, true, 1100),
      frame(6000, false, 2000, true),
      frame(8000, false, 2000, true),
      // Half of 30 s held 0.5 s after the reason: within the quiet, so it waits, and is said at the next frame past it.
      frame(8500, true, 15_000),
      frame(9500, true, 16_000),
      frame(10_500, true, 17_000),
    ];
    expect(steps.map((f) => coach.hold(f, 30)?.words ?? "-")).toEqual(["-", "-", "-", "Keep your whole body in view.", "-", "-", "-", "Keep your whole body in view.", "-", "Halfway.", "-"]);
  });

  it("no \"Halfway.\" for a hold under 20 s", () => {
    const coach = new Coach(null, WORDS);
    expect([frame(0, true, 0), frame(5000, true, 5000), frame(9000, true, 9000)].map((f) => coach.hold(f, 10)?.words ?? "-")).toEqual(["-", "-", "-"]);
  });
});

describe("a camera file's corrections", () => {
  it("a correction and the words of a rep its mistake refuses are one phrase", () => {
    const other = { ...EXERCISE, mistakes: EXERCISE.mistakes.map((m) => (m.id === "lean_forward" && m.camera === "checked" ? { ...m, coach: { words: "Lift your chest." } } : m)) };
    expect(() => parseExercise(other, SQUAT)).toThrow(/one phrase for one thing/);
  });

  it("every mistake the camera checks says its correction or why it is silent, never neither", () => {
    const none = { ...EXERCISE, mistakes: EXERCISE.mistakes.map((m) => (m.camera === "checked" ? { ...m, coach: undefined } : m)) };
    expect(() => parseExercise(none, SQUAT)).toThrow();
  });
});

describe("the voice file holds every line the coach says", () => {
  it("its own lines are found by their first wording", () => {
    expect(Object.values(WORDS).sort()).toEqual(["Better.", "Halfway.", "Last one.", "Set complete.", "That one counts.", "The camera can't see you.", "Two more."]);
  });

  it("a voice file without one of them is refused", () => {
    const voice = voiceSchema.parse(JSON.parse(readFileSync(VOICE_FILE, "utf8")));
    expect(() => coachWords({ ...voice, lines: voice.lines.filter((l) => l.when !== "better") })).toThrow(/better/);
  });
});

// A type-only check that `Say` stays what the app reads.
const said: Say = { words: "Halfway.", kind: "count", times: 0, t: 0 };
void said;
