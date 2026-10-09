// A gym's challenges (spec Part 3 §15.6; ROADMAP 19d-i): what may be saved, where a
// challenge is on the gym's calendar, and what a member can do about it.
//
// The expected answers are written out from the spec's words, case by case, not read back
// from the rule.
import { describe, expect, it } from "vitest";
import {
  addGymChallengeRequestSchema,
  challengeCan,
  challengeLength,
  challengeSaveProblem,
  challengeState,
  challengeTakesTeams,
  changeGymChallengeRequestSchema,
  placeTeams,
  teamNameKey,
  type ChallengeRules,
  type GymChallengeSaveProblem,
} from "../src/index.js";

const TODAY = "2026-10-07";

const rules = (over: Partial<ChallengeRules> = {}): ChallengeRules => ({
  counts: "gym_days",
  startsOn: "2026-10-10",
  endsOn: "2026-10-31",
  target: null,
  who: "everyone",
  lowestWins: false,
  teams: "none",
  teamList: [],
  ...over,
});

describe("where a challenge is on the gym's calendar", () => {
  it.each([
    ["the day before its first day", "2026-10-09", "coming"],
    ["its first day", "2026-10-10", "running"],
    ["a day inside it", "2026-10-20", "running"],
    ["its last day", "2026-10-31", "running"],
    ["the day after its last day", "2026-11-01", "ended"],
  ] as const)("%s is %s", (_what, today, state) => {
    expect(challengeState(rules(), today)).toBe(state);
  });

  it("a one-day challenge runs on its day and on no other", () => {
    const one = rules({ startsOn: TODAY, endsOn: TODAY });
    expect([challengeState(one, "2026-10-06"), challengeState(one, TODAY), challengeState(one, "2026-10-08")]).toEqual(["coming", "running", "ended"]);
    expect(challengeLength(one)).toBe(1);
  });

  it("counts both its first and last day, across a month's end and a leap day", () => {
    expect(challengeLength({ startsOn: "2026-10-01", endsOn: "2026-10-31" })).toBe(31);
    expect(challengeLength({ startsOn: "2028-02-28", endsOn: "2028-03-01" })).toBe(3);
  });
});

describe("what may be saved", () => {
  const NEW: [string, Partial<ChallengeRules>, GymChallengeSaveProblem | null][] = [
    ["starts today", { startsOn: TODAY }, null],
    ["starts next week", {}, null],
    ["started 31 days back", { startsOn: "2026-09-06" }, null],
    ["started 32 days back", { startsOn: "2026-09-05" }, "starts_too_early"],
    ["starts 365 days ahead", { startsOn: "2027-10-07", endsOn: "2027-10-31" }, null],
    ["starts 366 days ahead", { startsOn: "2027-10-08", endsOn: "2027-10-31" }, "starts_too_far"],
    ["started last week and ends today", { startsOn: "2026-10-01", endsOn: TODAY }, null],
    ["started last week and ended yesterday", { startsOn: "2026-10-01", endsOn: "2026-10-06" }, "ends_before_today"],
  ];
  it.each(NEW)("a new challenge that %s", (_what, over, problem) => {
    expect(challengeSaveProblem({ today: TODAY, before: null, next: rules(over) })).toBe(problem);
  });

  const COMING: [string, Partial<ChallengeRules>, GymChallengeSaveProblem | null][] = [
    ["counts something else", { counts: "workout_days" }, null],
    ["starts on another day", { startsOn: "2026-10-12" }, null],
    ["is for the people who join", { who: "joined" }, null],
    ["has a target", { target: 12 }, null],
    ["starts today", { startsOn: TODAY }, null],
    ["starts 32 days back", { startsOn: "2026-09-05" }, "starts_too_early"],
    ["starts more than a year ahead", { startsOn: "2027-10-08", endsOn: "2027-10-31" }, "starts_too_far"],
  ];
  it.each(COMING)("a challenge not yet started, changed so it %s", (_what, over, problem) => {
    expect(challengeSaveProblem({ today: TODAY, before: rules(), next: rules(over) })).toBe(problem);
  });

  const running = rules({ startsOn: "2026-10-01", target: 12, who: "joined" });
  const RUNNING: [string, Partial<ChallengeRules>, GymChallengeSaveProblem | null][] = [
    ["nothing", {}, null],
    ["a later last day", { endsOn: "2026-11-15" }, null],
    ["today as its last day", { endsOn: TODAY }, null],
    ["yesterday as its last day", { endsOn: "2026-10-06" }, "ends_before_today"],
    ["what it counts", { counts: "workout_days" }, "started_locked"],
    ["its first day", { startsOn: "2026-10-02" }, "started_locked"],
    ["who is in it", { who: "everyone" }, "started_locked"],
    ["its target", { target: 10 }, "started_locked"],
    ["its target taken off", { target: null }, "started_locked"],
  ];
  it.each(RUNNING)("a running challenge changing %s", (_what, over, problem) => {
    expect(challengeSaveProblem({ today: TODAY, before: running, next: { ...running, ...over } })).toBe(problem);
  });

  it("a challenge on its first day is already locked, and one starting tomorrow is not", () => {
    const today = rules({ startsOn: TODAY });
    expect(challengeSaveProblem({ today: TODAY, before: today, next: { ...today, target: 5 } })).toBe("started_locked");
    const tomorrow = rules({ startsOn: "2026-10-08" });
    expect(challengeSaveProblem({ today: TODAY, before: tomorrow, next: { ...tomorrow, target: 5 } })).toBeNull();
  });

  it("an ended challenge takes no change at all, not even one that would be allowed while running", () => {
    const ended = rules({ startsOn: "2026-09-01", endsOn: "2026-10-06" });
    expect(challengeSaveProblem({ today: TODAY, before: ended, next: ended })).toBe("ended");
    expect(challengeSaveProblem({ today: TODAY, before: ended, next: { ...ended, endsOn: "2026-10-31" } })).toBe("ended");
  });
});

describe("what a member can do", () => {
  const base = { who: "joined", cancelled: false, state: "running", joined: false, teams: "none", hasTeam: false } as const;
  const picks = { ...base, teams: "members" } as const;
  it.each([
    ["a challenge people join, not joined", base, { join: true, leave: false, pick: false }],
    ["joined", { ...base, joined: true }, { join: false, leave: true, pick: false }],
    ["not started yet", { ...base, state: "coming" }, { join: true, leave: false, pick: false }],
    ["not started yet, joined", { ...base, state: "coming", joined: true }, { join: false, leave: true, pick: false }],
    ["ended", { ...base, state: "ended" }, { join: false, leave: false, pick: false }],
    ["ended, joined", { ...base, state: "ended", joined: true }, { join: false, leave: false, pick: false }],
    ["cancelled", { ...base, cancelled: true }, { join: false, leave: false, pick: false }],
    ["cancelled, joined", { ...base, cancelled: true, joined: true }, { join: false, leave: false, pick: false }],
    ["everyone's challenge", { ...base, who: "everyone" }, { join: false, leave: false, pick: false }],
    // In teams. Where staff make them a member never picks, and joins as before.
    ["staff make the teams, not joined", { ...base, teams: "staff" }, { join: true, leave: false, pick: false }],
    ["staff make the teams, in one", { ...base, teams: "staff", joined: true, hasTeam: true }, { join: false, leave: true, pick: false }],
    // Where members pick, picking is how they join: no Join button beside it.
    ["members pick, in no team", picks, { join: false, leave: false, pick: true }],
    ["members pick, in no team, before it starts", { ...picks, state: "coming" }, { join: false, leave: false, pick: true }],
    ["members pick, in a team, before it starts: they may change", { ...picks, state: "coming", joined: true, hasTeam: true }, { join: false, leave: true, pick: true }],
    ["members pick, in a team, once it runs: no change", { ...picks, joined: true, hasTeam: true }, { join: false, leave: true, pick: false }],
    ["members pick, left after it started: back into the same team only", { ...picks, hasTeam: true }, { join: true, leave: false, pick: false }],
    ["members pick, joined and staff took them out of their team", { ...picks, joined: true }, { join: false, leave: true, pick: true }],
    ["members pick, everyone's challenge, in no team", { ...picks, who: "everyone" }, { join: false, leave: false, pick: true }],
    ["members pick, everyone's challenge, in a team, running", { ...picks, who: "everyone", hasTeam: true }, { join: false, leave: false, pick: false }],
    ["members pick, ended", { ...picks, state: "ended" }, { join: false, leave: false, pick: false }],
    ["members pick, cancelled", { ...picks, cancelled: true }, { join: false, leave: false, pick: false }],
  ] as const)("%s", (_what, input, can) => {
    expect(challengeCan(input)).toEqual(can);
  });
});

describe("the request", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    challengeKey: "00000000-0000-4000-8000-000000000081",
    name: "October Challenge",
    details: "",
    prize: "",
    counts: "gym_days",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    target: null,
    who: "everyone",
    ...over,
  });
  const ok = (over: Record<string, unknown>): boolean => addGymChallengeRequestSchema.safeParse(body(over)).success;

  it.each([
    ["as it stands", {}, true],
    ["a target of every day", { target: 31 }, true],
    ["a target of one more than its days", { target: 32 }, false],
    ["a target of nothing", { target: 0 }, false],
    ["a last day before the first", { endsOn: "2026-09-30" }, false],
    ["one day long", { endsOn: "2026-10-01" }, true],
    ["366 days long", { endsOn: "2027-10-01" }, true],
    ["367 days long", { endsOn: "2027-10-02" }, false],
    ["a day that is no day", { startsOn: "2026-02-30" }, false],
    ["a name of spaces", { name: "   " }, false],
    ["a name of 80 characters", { name: "a".repeat(80) }, true],
    ["a name of 81", { name: "a".repeat(81) }, false],
    ["a prize of 121 characters", { prize: "p".repeat(121) }, false],
    ["details of 501 characters", { details: "d".repeat(501) }, false],
    ["something else counted", { counts: "streak" }, false],
    ["a field of its own", { winner: "me" }, false],
  ])("%s", (_what, over, accepted) => {
    expect(ok(over)).toBe(accepted);
  });

  it("trims what was typed, and a change carries no key", () => {
    const parsed = addGymChallengeRequestSchema.parse(body({ name: "  October  ", prize: " A shaker " }));
    expect([parsed.name, parsed.prize]).toEqual(["October", "A shaker"]);
    const fields: Record<string, unknown> = body();
    expect(changeGymChallengeRequestSchema.safeParse(fields).success).toBe(false);
    delete fields["challengeKey"];
    expect(changeGymChallengeRequestSchema.safeParse(fields).success).toBe(true);
  });
});

// ── TEAMS (ROADMAP 19d-ii-a) ──

describe("a team's place", () => {
  const T = (id: string, value: number) => ({ id, value });
  const places = (teams: { id: string; value: number }[], lowestWins = false) => Object.fromEntries(placeTeams(teams, lowestWins));
  it.each([
    ["the highest number is first", [T("a", 40), T("b", 90), T("c", 10)], false, { a: 2, b: 1, c: 3 }],
    ["two level share a place, and the next is third", [T("a", 50), T("b", 50), T("c", 10)], false, { a: 1, b: 1, c: 3 }],
    ["all level", [T("a", 7), T("b", 7), T("c", 7)], false, { a: 1, b: 1, c: 1 }],
    ["a team with no number has no place", [T("a", 12), T("b", 0), T("c", 3)], false, { a: 1, b: null, c: 2 }],
    ["nobody has a number", [T("a", 0), T("b", 0)], false, { a: null, b: null }],
    ["a team of one against a team of many, by the number alone", [T("solo", 30), T("many", 29)], false, { solo: 1, many: 2 }],
    ["one team", [T("a", 4)], false, { a: 1 }],
    ["no teams", [], false, {}],
    ["the lowest wins: the smallest number is first", [T("a", 40), T("b", 90), T("c", 10)], true, { a: 2, b: 3, c: 1 }],
    ["the lowest wins: a team with no number is not first", [T("a", 40), T("b", 0), T("c", 10)], true, { a: 2, b: null, c: 1 }],
    ["the lowest wins: two level", [T("a", 15), T("b", 15), T("c", 99)], true, { a: 1, b: 1, c: 3 }],
    ["eight teams, two groups level", [T("a", 8), T("b", 6), T("c", 6), T("d", 5), T("e", 5), T("f", 5), T("g", 1), T("h", 0)], false, { a: 1, b: 2, c: 2, d: 4, e: 4, f: 4, g: 7, h: null }],
  ] as const)("%s", (_what, teams, lowestWins, expected) => {
    expect(places([...teams], lowestWins)).toEqual(expected);
  });
});

describe("teams in the request", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    name: "October Challenge",
    details: "",
    prize: "",
    counts: "gym_days",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    target: null,
    who: "everyone",
    ...over,
  });
  const team = (name: string, id: string | null = null) => ({ id, name });
  const ID = "00000000-0000-4000-8000-0000000000a1";
  const ok = (over: Record<string, unknown>): boolean => changeGymChallengeRequestSchema.safeParse(body(over)).success;

  it("a challenge sent with no word about teams is one people are in alone", () => {
    const parsed = changeGymChallengeRequestSchema.parse(body());
    expect(parsed.teams).toBe("none");
    expect(parsed.teamList).toEqual([]);
  });

  it.each([
    ["two teams, staff make them", { teams: "staff", teamList: [team("Red"), team("Blue")] }, true],
    ["eight teams, members pick", { teams: "members", teamList: ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => team(n)) }, true],
    ["nine teams", { teams: "staff", teamList: ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((n) => team(n)) }, false],
    ["one team", { teams: "staff", teamList: [team("Red")] }, false],
    ["in teams with none named", { teams: "members", teamList: [] }, false],
    ["alone, with teams named", { teams: "none", teamList: [team("Red"), team("Blue")] }, false],
    ["two teams with one name", { teams: "staff", teamList: [team("Red"), team("Red")] }, false],
    ["one name in other capitals", { teams: "staff", teamList: [team("Red Team"), team("RED  team")] }, false],
    ["one name in full-width letters", { teams: "staff", teamList: [team("Red"), team("Ｒｅｄ")] }, false],
    ["a name nobody can see", { teams: "staff", teamList: [team("Red"), team("​")] }, false],
    ["a name of spaces", { teams: "staff", teamList: [team("Red"), team("   ")] }, false],
    ["a name of 40 characters", { teams: "staff", teamList: [team("Red"), team("x".repeat(40))] }, true],
    ["a name of 41 characters", { teams: "staff", teamList: [team("Red"), team("x".repeat(41))] }, false],
    ["one kept team listed twice", { teams: "staff", teamList: [team("Red", ID), team("Blue", ID)] }, false],
    ["an id that is not one", { teams: "staff", teamList: [team("Red", "nope"), team("Blue")] }, false],
    ["a kind of teams nobody knows", { teams: "pairs", teamList: [team("Red"), team("Blue")] }, false],
  ] as const)("%s", (_what, over, expected) => {
    expect(ok(over)).toBe(expected);
  });

  it("a team's target is not bound by the challenge's days; one person's is", () => {
    const week = { startsOn: "2026-10-01", endsOn: "2026-10-07", target: 100 };
    expect(ok(week)).toBe(false);
    expect(ok({ ...week, teams: "staff", teamList: [team("Red"), team("Blue")] })).toBe(true);
  });

  it("a name is kept trimmed", () => {
    const parsed = changeGymChallengeRequestSchema.parse(body({ teams: "staff", teamList: [team("  Red  "), team("Blue")] }));
    expect(parsed.teamList.map((t) => t.name)).toEqual(["Red", "Blue"]);
  });

  it("names are compared as a person reads them", () => {
    expect(teamNameKey("  RED   Team ")).toBe("red team");
    expect(teamNameKey("Ｒｅｄ")).toBe("red");
  });
});

describe("teams once a challenge has started", () => {
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b1";
  const red = { id: A, name: "Red" };
  const blue = { id: B, name: "Blue" };
  const kept = [red, blue];
  const running = rules({ startsOn: "2026-10-01", endsOn: "2026-10-31", teams: "staff", teamList: kept });
  const coming = rules({ teams: "staff", teamList: kept });
  const problem = (before: ChallengeRules, over: Partial<ChallengeRules>): GymChallengeSaveProblem | null =>
    challengeSaveProblem({ today: TODAY, before, next: { ...before, ...over } });

  const cases: [string, Partial<ChallengeRules>, GymChallengeSaveProblem | null][] = [
    ["nothing changed", {}, null],
    ["its last day", { endsOn: "2026-11-05" }, null],
    ["a team renamed", { teamList: [{ id: A, name: "Reds" }, blue] }, "started_locked"],
    ["a team added", { teamList: [...kept, { id: null, name: "Green" }] }, "started_locked"],
    ["a team removed and another added", { teamList: [red, { id: null, name: "Green" }] }, "started_locked"],
    ["the teams in another order", { teamList: [blue, red] }, "started_locked"],
    ["members pick where staff made them", { teams: "members" }, "started_locked"],
    ["made a challenge people are in alone", { teams: "none", teamList: [] }, "started_locked"],
  ];
  it.each(cases)("running: %s", (_what, over, expected) => {
    expect(problem(running, over)).toBe(expected);
  });

  it("a running challenge people are in alone cannot be put in teams", () => {
    const alone = rules({ startsOn: "2026-10-01", endsOn: "2026-10-31" });
    expect(problem(alone, { teams: "staff", teamList: [{ id: null, name: "Red" }, { id: null, name: "Blue" }] })).toBe("started_locked");
  });

  it("before its first day everything about its teams can change", () => {
    expect(problem(coming, { teams: "members", teamList: [{ id: A, name: "Reds" }, { id: null, name: "Green" }] })).toBeNull();
    expect(problem(coming, { teams: "none", teamList: [] })).toBeNull();
  });
});

describe("when staff may put people in teams", () => {
  const c = { teams: "staff", endsOn: "2026-10-31", cancelled: false } as const;
  it.each([
    ["before it starts and while it runs", c, "2026-10-07", true],
    ["on its last day", c, "2026-10-31", true],
    ["the day after", c, "2026-11-01", false],
    ["cancelled", { ...c, cancelled: true }, "2026-10-07", false],
    ["where members pick, staff still may", { ...c, teams: "members" }, "2026-10-07", true],
    ["a challenge people are in alone", { ...c, teams: "none" }, "2026-10-07", false],
  ] as const)("%s", (_what, challenge, today, expected) => {
    expect(challengeTakesTeams(challenge, today)).toBe(expected);
  });
});
