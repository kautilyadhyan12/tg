// A GYM'S SETTINGS FOR ITS AUTOMATIC MESSAGES, AND THE THREE NEW KINDS' RULES AND WORDS
// (spec Part 3 §16.2; ROADMAP 20b-i).
import { describe, expect, it } from "vitest";
import {
  GYM_MESSAGE_STARTING_NUMBERS,
  GYM_MESSAGE_STARTING_ON,
  automaticMessage,
  gymInboxResponseSchema,
  gymMessageDue,
  gymMessageOccasions,
  missYouGymDays,
  type GymMessageFacts,
} from "../src/gymMessages.js";
import {
  GYM_MESSAGE_MEMBER_SWITCH_KINDS,
  GYM_MESSAGE_OWN_LINE_MAX,
  GYM_MESSAGE_SETTING_KINDS,
  gymMessageSettingsFrom,
  gymMessageSettingsRequestSchema,
  gymMessageSwitchRequestSchema,
  ownLineProblem,
  tidyOwnLine,
} from "../src/gymMessageSettings.js";

const TODAY = "2026-10-09";
const back = (n: number): string => new Date(Date.UTC(2026, 9, 9) - n * 86_400_000).toISOString().slice(0, 10);
/** The gym checked somebody in on each of the last `n` days, today among them. */
const lastDays = (n: number): string[] => Array.from({ length: n }, (_, i) => back(i));

type Person = GymMessageFacts["person"];
const nobody: Person = {
  member: true,
  former: false,
  staff: false,
  off: [],
  joinedOn: "2026-01-05",
  joinedUtcOn: "2026-01-05",
  trial: null,
  membershipEndsOn: null,
  bills: [],
  birthday: null,
  visits: 12,
  recentVisitDays: 0,
  lastVisitOn: back(2),
};
const facts = (person: Partial<Person>, gym: Partial<GymMessageFacts["gym"]> = {}): GymMessageFacts => ({
  gym: { open: true, live: true, today: TODAY, hour: 12, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, visitDays: lastDays(60), ...gym },
  person: { ...nobody, ...person },
  sent: [],
});
const occasions = (person: Partial<Person>, gym: Partial<GymMessageFacts["gym"]> = {}) => gymMessageOccasions(facts(person, gym)).map((o) => `${o.kind} ${o.occasion}`);

describe("we miss you", () => {
  it("waits for the gym's days, and for the gym to have checked somebody in on half of them since", () => {
    expect(missYouGymDays(10)).toBe(5);
    expect(missYouGymDays(7)).toBe(4);
    expect(occasions({ lastVisitOn: back(10) })).toEqual([`miss_you absent:${back(10)}`]);
    expect(occasions({ lastVisitOn: back(9) })).toEqual([]);
    // Every case below: the person last came 12 days ago.
    const gone = { lastVisitOn: back(12) };
    const table: [string, string[], boolean][] = [
      ["the desk in use every day", lastDays(60), true],
      ["the gym never used check-in after it", [back(12), back(13), back(14)], false],
      ["no check-in at all", [], false],
      ["four check-in days since", [back(0), back(1), back(2), back(3), back(12)], false],
      ["five check-in days since", [back(0), back(1), back(2), back(3), back(4), back(12)], true],
      ["shut since, open again today", [back(0), back(12), back(13)], false],
      ["the days of the last visit and before are not since", [back(12), back(13), back(14), back(15), back(16), back(17)], false],
      ["the same day twice is one day", [back(0), back(0), back(1), back(1), back(2)], false],
      ["a day after today is not counted", ["2026-10-10", "2026-10-11", "2026-10-12", back(0), back(1)], false],
      ["a day that is not a day is not counted", ["soon", "", "2026-02-30", "x", "y", back(0)], false],
    ];
    for (const [name, visitDays, due] of table) expect(occasions(gone, { visitDays }), name).toEqual(due ? [`miss_you absent:${back(12)}`] : []);
  });

  it("is never for the gym's own staff, nor for somebody who never came", () => {
    expect(occasions({ lastVisitOn: back(30), staff: true })).toEqual([]);
    expect(occasions({ lastVisitOn: null, visits: 0 })).toEqual([]);
  });

  it("follows the gym's own number", () => {
    const seven = { ...GYM_MESSAGE_STARTING_NUMBERS, missYouDays: 7 };
    expect(occasions({ lastVisitOn: back(7) }, { numbers: seven })).toEqual([`miss_you absent:${back(7)}`]);
    expect(occasions({ lastVisitOn: back(6) }, { numbers: seven })).toEqual([]);
  });
});

describe("a visit milestone", () => {
  const at = (visits: number, recentVisitDays: number, lastVisitOn: string = TODAY) => occasions({ visits, recentVisitDays, lastVisitOn });
  it("is the newest one reached by a visit of today or yesterday", () => {
    const table: [number, number, string, string[]][] = [
      [49, 1, TODAY, []],
      [50, 1, TODAY, ["milestone visits:50"]],
      [50, 1, back(1), ["milestone visits:50"]],
      [50, 0, back(2), []],
      // The 50th yesterday and the 51st today.
      [51, 2, TODAY, ["milestone visits:50"]],
      [51, 1, TODAY, []],
      [52, 2, TODAY, []],
      [100, 1, TODAY, ["milestone visits:100"]],
      [101, 2, TODAY, ["milestone visits:100"]],
      [0, 0, TODAY, []],
    ];
    for (const [visits, recent, last, want] of table) expect(at(visits, recent, last), `${String(visits)} ${String(recent)} ${last}`).toEqual(want);
  });

  it("follows the gym's own numbers, and a count that is no count reaches none", () => {
    const numbers = { ...GYM_MESSAGE_STARTING_NUMBERS, milestones: [10, 11] };
    expect(occasions({ visits: 11, recentVisitDays: 2, lastVisitOn: TODAY }, { numbers })).toEqual(["milestone visits:11"]);
    expect(occasions({ visits: 50, recentVisitDays: 1, lastVisitOn: TODAY }, { numbers })).toEqual([]);
    expect(at(50, Number.NaN)).toEqual([]);
    expect(at(50, -3)).toEqual([]);
    // More than two recent days cannot be: read as two.
    expect(at(52, 9)).toEqual([]);
  });

  it("one message a day: a birthday goes before a milestone, which goes the next day if it still can", () => {
    const due = gymMessageDue(facts({ visits: 50, recentVisitDays: 1, lastVisitOn: TODAY, birthday: "10-09" }));
    expect(due.send).toEqual({ kind: "birthday", occasion: "birthday:2026" });
    expect(due.held).toEqual([{ kind: "milestone", occasion: "visits:50", reason: "another_today" }]);
  });
});

describe("the words", () => {
  it("each kind sent has fixed words with the gym's name and the first name, and the gym's line on a line of its own", () => {
    const say = (kind: "welcome" | "birthday" | "milestone" | "miss_you", occasion: string, name: string | null, line: string | null = null) =>
      automaticMessage({ kind, occasion }, " Iron House ", name, line);
    expect(say("birthday", "birthday:2026", "Maya Rao")).toBe("Happy birthday, Maya! From everyone at Iron House.");
    expect(say("birthday", "birthday:2026", "maya@example.com")).toBe("Happy birthday! From everyone at Iron House.");
    expect(say("miss_you", "absent:2026-09-27", "Maya Rao")).toBe("We haven't seen you at Iron House for a while, Maya. We hope to see you soon.");
    expect(say("miss_you", "absent:2026-09-27", null)).toBe("We haven't seen you at Iron House for a while. We hope to see you soon.");
    expect(say("milestone", "visits:50", "Maya Rao")).toBe("That's 50 visits to Iron House, Maya. Well done.");
    expect(say("milestone", "visits:1000", null)).toBe("That's 1,000 visits to Iron House. Well done.");
    expect(say("welcome", "joined:2026-10-09", "Maya Rao", "Your first class is free.")).toBe(
      "Welcome to Iron House, Maya. We're glad you joined. Messages from us will show up here.\nYour first class is free.",
    );
    expect(say("birthday", "birthday:2026", "Maya", "   ")).toBe("Happy birthday, Maya! From everyone at Iron House.");
  });

  it("a kind with no words yet, and a milestone that names no number, say nothing", () => {
    for (const kind of ["payment_overdue", "membership_ending", "trial_ending", "trial_check_in"] as const) expect(automaticMessage({ kind, occasion: "x" }, "Iron House", "Maya", "A line")).toBeNull();
    for (const occasion of ["visits:", "visits:0", "visits:5x", "visits:-5", "50", "visits:1234567"]) expect(automaticMessage({ kind: "milestone", occasion }, "Iron House", "Maya", null), occasion).toBeNull();
  });
});

describe("the gym's own line", () => {
  // Lines a gym would write, in its own words; none of them is a link.
  const FINE = [
    "Your first class back is on us.",
    "Show this at the desk for a free coffee ☕",
    "Open 6am-10pm Mon-Fri, 8-6 Sat & Sun.",
    "Ask for Priya at reception. She'll sort you out.",
    "Bring a friend free this month!",
    "Vous nous manquez. À bientôt !",
    "हम आपको याद कर रहे हैं",
    "Call us on 020 7946 0958.",
    "",
  ];
  const HELD: [string, "link" | "at" | "too_long"][] = [
    ["Book at ironhouse.com", "link"],
    ["See www.ironhouse.co.uk", "link"],
    ["https://bit.ly/3xYz", "link"],
    ["Message wa.me/447700900123", "link"],
    ["Find us on ironhouse.fit", "link"],
    ["Follow @ironhousegym", "at"],
    ["Email hello@ironhouse.com", "at"],
    ["Follow ＠ironhouse", "at"],
    ["x".repeat(GYM_MESSAGE_OWN_LINE_MAX + 1), "too_long"],
  ];
  it("is kept unless it is too long or holds a web address or an @", () => {
    for (const line of FINE) expect(ownLineProblem(tidyOwnLine(line)), line).toBeNull();
    for (const [line, why] of HELD) expect(ownLineProblem(tidyOwnLine(line)), line).toBe(why);
    expect(ownLineProblem(`${"x".repeat(GYM_MESSAGE_OWN_LINE_MAX - 1)}🎂`)).toBeNull();
  });

  it("is one line, tidied", () => {
    expect(tidyOwnLine("  Cake at the desk.\r\n\r\nCome and get it.  ")).toBe("Cake at the desk. Come and get it.");
    expect(tidyOwnLine(" \n ")).toBe("");
  });
});

describe("what is kept, and the shapes", () => {
  it("a gym with no rows has the starting values; its rows change only their own kind", () => {
    expect(gymMessageSettingsFrom([])).toEqual({ on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, ownLines: {} });
    const set = gymMessageSettingsFrom([
      { kind: "birthday", on: false, ownLine: "Cake at the desk", days: null, milestones: null },
      { kind: "miss_you", on: true, ownLine: null, days: 21, milestones: null },
      { kind: "milestone", on: true, ownLine: " ", days: null, milestones: [100, 10] },
    ]);
    expect(set.on).toEqual({ ...GYM_MESSAGE_STARTING_ON, birthday: false });
    expect(set.numbers).toEqual({ ...GYM_MESSAGE_STARTING_NUMBERS, missYouDays: 21, milestones: [10, 100] });
    expect(set.ownLines).toEqual({ birthday: "Cake at the desk" });
  });

  it("a number that is not one is left at its start", () => {
    const set = gymMessageSettingsFrom([
      { kind: "miss_you", on: true, ownLine: null, days: 0, milestones: null },
      { kind: "milestone", on: true, ownLine: null, days: 5, milestones: [50, -1] },
      { kind: "welcome", on: true, ownLine: null, days: 3, milestones: [1] },
    ]);
    expect(set.numbers).toEqual(GYM_MESSAGE_STARTING_NUMBERS);
  });

  it("a save names every kind once and only numbers on offer; a member's switch only a kind with one", () => {
    const messages = GYM_MESSAGE_SETTING_KINDS.map((kind) => ({ kind, on: true, ownLine: null }));
    const ok = { messages, missYouDays: 14, milestones: [25, 250] };
    expect(gymMessageSettingsRequestSchema.safeParse(ok).success).toBe(true);
    const bad = [
      { ...ok, missYouDays: 12 },
      { ...ok, milestones: [25, 25] },
      { ...ok, milestones: [] },
      { ...ok, milestones: [60] },
      { ...ok, messages: messages.slice(1) },
      { ...ok, messages: [...messages.slice(1), messages[1]] },
      { ...ok, messages: messages.map((m) => ({ ...m, days: 3 })) },
      { ...ok, extra: true },
    ];
    for (const body of bad) expect(gymMessageSettingsRequestSchema.safeParse(body).success, JSON.stringify(body).slice(0, 80)).toBe(false);
    for (const kind of GYM_MESSAGE_MEMBER_SWITCH_KINDS) expect(gymMessageSwitchRequestSchema.safeParse({ kind, on: false }).success).toBe(true);
    for (const kind of ["welcome", "payment_overdue", "group", "x"]) expect(gymMessageSwitchRequestSchema.safeParse({ kind, on: false }).success, kind).toBe(false);
  });

  it("an inbox from an older server, with no switches in it, reads as none off", () => {
    const reply = { gymId: "11111111-1111-4111-8111-111111111111", gymName: "Iron House", status: "shown", messages: [], unread: 0, asOf: "2026-10-09T06:31:00.000Z" };
    expect(gymInboxResponseSchema.parse(reply).off).toEqual([]);
    expect(gymInboxResponseSchema.parse({ ...reply, off: ["birthday"] }).off).toEqual(["birthday"]);
    expect(gymInboxResponseSchema.safeParse({ ...reply, off: ["advert"] }).success).toBe(false);
  });
});
