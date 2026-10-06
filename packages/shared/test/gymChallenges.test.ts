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
  changeGymChallengeRequestSchema,
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
  const base = { who: "joined", cancelled: false, state: "running", joined: false } as const;
  it.each([
    ["a challenge people join, not joined", base, { join: true, leave: false }],
    ["joined", { ...base, joined: true }, { join: false, leave: true }],
    ["not started yet", { ...base, state: "coming" }, { join: true, leave: false }],
    ["not started yet, joined", { ...base, state: "coming", joined: true }, { join: false, leave: true }],
    ["ended", { ...base, state: "ended" }, { join: false, leave: false }],
    ["ended, joined", { ...base, state: "ended", joined: true }, { join: false, leave: false }],
    ["cancelled", { ...base, cancelled: true }, { join: false, leave: false }],
    ["cancelled, joined", { ...base, cancelled: true, joined: true }, { join: false, leave: false }],
    ["everyone's challenge", { ...base, who: "everyone" }, { join: false, leave: false }],
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
