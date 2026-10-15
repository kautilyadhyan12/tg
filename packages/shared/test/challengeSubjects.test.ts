// What a challenge can be about (spec Part 3 §15.10.1; ROADMAP 19d-iii-a-i): which kinds a
// gym may ask for, how each may be won, and the words each is sent with. The expected
// answers are written out from the spec's table and words, case by case.
import { describe, expect, it } from "vitest";
import { CHALLENGE_SUBJECTS, addGymChallengeRequestSchema, challengeWords, kindOnTheList, oneOf, type ChallengeKind } from "../src/index.js";

const body = (over: Record<string, unknown> = {}) => ({
  challengeKey: "00000000-0000-4000-8000-000000000118",
  name: "October Challenge",
  details: "",
  prize: "",
  subject: "gym_visits",
  measure: "days",
  countedBy: "app",
  startsOn: "2026-10-01",
  endsOn: "2026-10-07",
  target: null,
  who: "everyone",
  ...over,
});
const ok = (over: Record<string, unknown>): boolean => addGymChallengeRequestSchema.safeParse(body(over)).success;
const staff = { subject: "own", measure: null, countedBy: "staff", unit: "push-ups" };
const teams = { teams: "staff", teamList: [{ id: null, name: "Reds" }, { id: null, name: "Blues" }] };

describe("what a gym may ask a challenge to be about, and who counts it", () => {
  it.each([
    // The three kinds a gym had before 19d-iii-a-i, as the migration keeps them.
    ["gym visits, counted by the app in days", {}, true],
    ["workouts in the app, counted in days", { subject: "workouts" }, true],
    ["something the gym names, counted by its staff", staff, true],
    // The staff may count anything on the list, in their own word.
    ["gym visits counted by the staff", { measure: null, countedBy: "staff", unit: "visits" }, true],
    // Never: something the app cannot count, or counted a way the list does not have.
    ["something of the gym's own, counted by the app", { subject: "own" }, false],
    ["gym visits with no measure, counted by the app", { measure: null }, false],
    ["gym visits measured in reps", { measure: "reps" }, false],
    ["a measure where the staff count", { countedBy: "staff", unit: "visits" }, false],
    ["a subject not on the list (steps)", { subject: "steps" }, false],
    ["a subject not on the list (running, until the phone records runs)", { subject: "running", measure: "metres" }, false],
    ["meals, which the app never counts for a gym", { subject: "meals" }, false],
    ["a subject in capitals", { subject: "Gym_Visits" }, false],
    ["a subject of nothing", { subject: "" }, false],
    ["the camera as who counts it", { countedBy: "camera" }, false],
    ["no word for who counts it", { countedBy: undefined }, false],
  ])("%s", (_what, over, accepted) => {
    expect(ok(over)).toBe(accepted);
  });

  it.each([
    ["the app counts it and a word is typed", { unit: "visits" }, false],
    ["the staff count it with no word", { ...staff, unit: "" }, false],
    ["the staff count it with a word of spaces", { ...staff, unit: "   " }, false],
    ["a day-counted target of every day of a week", { target: 7 }, true],
    ["a day-counted target of one more than its days", { target: 8 }, false],
    ["the same target for a team, which adds its people's days", { target: 8, ...teams }, true],
    ["a staff-counted target past the days", { ...staff, target: 500 }, true],
    ["the lowest wins where the app counts days", { lowestWins: true }, false],
    ["the lowest wins where the staff count, with no target", { ...staff, lowestWins: true }, true],
    ["the lowest wins with a target", { ...staff, lowestWins: true, target: 50 }, false],
    ["only people who join", { who: "joined" }, true],
  ])("%s", (_what, over, accepted) => {
    expect(ok(over)).toBe(accepted);
  });

  it("the same rule, asked directly, for every subject on the list and one that is not", () => {
    const kinds: [ChallengeKind, boolean][] = [
      [{ subject: "gym_visits", measure: "days", countedBy: "app" }, true],
      [{ subject: "workouts", measure: "days", countedBy: "app" }, true],
      [{ subject: "own", measure: null, countedBy: "staff" }, true],
      [{ subject: "workouts", measure: null, countedBy: "staff" }, true],
      [{ subject: "own", measure: "days", countedBy: "app" }, false],
      [{ subject: "cycling", measure: null, countedBy: "staff" }, false],
    ];
    for (const [kind, onIt] of kinds) expect([kind, kindOnTheList(kind)]).toEqual([kind, onIt]);
  });
});

describe("the words a challenge is sent with", () => {
  it("gym visits: the front desk counts them, one a day", () => {
    expect(challengeWords({ subject: "gym_visits", measure: "days", countedBy: "app", unit: "" }, "Iron Gym")).toEqual({
      about: "Gym visits",
      one: "gym day",
      many: "gym days",
      print: "whole",
      how: "desk",
      howLine: "Checked in at the front desk",
      explain: "A gym day is a day you're checked in at Iron Gym: a scan at the front desk, or a check-in by staff. Two visits on one day are one. It is the same count as the Leaderboard.",
      perDay: true,
    });
  });

  it("workouts in the app: the app counts them, one a day", () => {
    expect(challengeWords({ subject: "workouts", measure: "days", countedBy: "app", unit: "" }, "Iron Gym")).toEqual({
      about: "Workouts in the app",
      one: "workout day",
      many: "workout days",
      print: "whole",
      how: "app",
      howLine: "Counted by the app",
      explain: "A workout day is a day you finish a workout in the app, at the gym or at home. Two on one day are one. It is the same count as the Leaderboard.",
      perDay: true,
    });
  });

  it("something the gym names: in its own word, counted by its staff", () => {
    expect(challengeWords({ subject: "own", measure: null, countedBy: "staff", unit: "push-ups" }, "Iron Gym")).toEqual({
      about: "Push-ups",
      one: "push-up",
      many: "push-ups",
      print: "whole",
      how: "staff",
      howLine: "Counted by the staff at Iron Gym",
      explain: "The staff at Iron Gym count the push-ups and add each person's number. If yours is missing or wrong, ask at the front desk.",
      perDay: false,
    });
  });

  it("a subject on the list that the staff count keeps the subject's own name", () => {
    expect(challengeWords({ subject: "workouts", measure: null, countedBy: "staff", unit: "sessions" }, "Iron Gym")).toMatchObject({ about: "Workouts in the app", one: "session", many: "sessions", how: "staff" });
  });

  it("an app count of a kind no longer on the list says it is not counted, never the staff's words or another kind's", () => {
    const words = challengeWords({ subject: "steps", measure: "steps", countedBy: "app", unit: "" }, "Iron Gym");
    expect(words).toEqual({
      about: "Challenge",
      one: "point",
      many: "points",
      print: "whole",
      how: "app",
      howLine: "Not counted yet",
      explain: "This challenge isn't being counted yet. Ask the staff at Iron Gym about it.",
      perDay: false,
    });
    expect(challengeWords({ subject: "gym_visits", measure: "reps", countedBy: "app", unit: "" }, "Iron Gym")).toMatchObject({ about: "Gym visits", howLine: "Not counted yet", perDay: false });
    expect(JSON.stringify(words)).not.toMatch(/gym day|workout day|Checked in|Counted by/u);
  });

  it("a measure is one a day exactly when its id is days, as the database's target check reads it", () => {
    const measures = CHALLENGE_SUBJECTS.flatMap((subject) => subject.measures.map((m) => [`${subject.id}.${m.id}`, m.perDay, m.id === "days"]));
    expect(measures.length).toBeGreaterThan(0);
    for (const [key, perDay, days] of measures) expect([key, perDay]).toEqual([key, days]);
  });
});

describe("one of the gym's own word", () => {
  // Words gyms count by, from real challenge boards: what is one of each?
  it.each([
    ["push-ups", "push-up"],
    ["Push-Ups", "Push-Up"],
    ["reps", "rep"],
    ["seconds", "second"],
    ["minutes", "minute"],
    ["kilometres", "kilometre"],
    ["laps", "lap"],
    ["lunges", "lunge"],
    ["burpees", "burpee"],
    ["boxes", "box"],
    ["crunches", "crunch"],
    ["passes", "pass"],
    ["presses", "press"],
    // Left as typed: not a plain plural, or not a plural at all.
    ["press", "press"],
    ["calories", "calorie"],
    ["abs", "abs"],
    ["series", "series"],
    ["kg lifted", "kg lifted"],
    ["5 km time", "5 km time"],
    ["km", "km"],
    ["bonus", "bonus"],
    ["tennis", "tennis"],
    ["kg", "kg"],
    ["公里", "公里"],
    ["x2s", "x2s"],
  ])("%s → %s", (typed, one) => {
    expect(oneOf(typed)).toBe(one);
    expect(challengeWords({ subject: "own", measure: null, countedBy: "staff", unit: typed }, "Iron Gym")).toMatchObject({ one, many: typed });
  });
});
