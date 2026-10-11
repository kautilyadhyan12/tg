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
  trustedBirthday,
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
  ending: null,
  bills: [],
  birthday: null,
  visits: 12,
  recentVisitDays: 0,
  lastVisitOn: back(2),
  lastSeenOn: back(2),
};
const facts = (person: Partial<Person>, gym: Partial<GymMessageFacts["gym"]> = {}): GymMessageFacts => ({
  gym: { open: true, live: true, today: TODAY, hour: 12, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, visitDays: lastDays(60), billsOverdueAfterDays: 0, takesPayments: true, ...gym },
  person: { ...nobody, ...person },
  sent: [],
});
const occasions = (person: Partial<Person>, gym: Partial<GymMessageFacts["gym"]> = {}) => gymMessageOccasions(facts(person, gym)).map((o) => `${o.kind} ${o.occasion}`);

describe("we miss you", () => {
  it("waits for the gym's days, and for the gym to have checked somebody in on half of them since", () => {
    expect(missYouGymDays(10)).toBe(5);
    expect(missYouGymDays(7)).toBe(4);
    expect(occasions({ lastSeenOn: back(10) })).toEqual([`miss_you absent:${back(10)}`]);
    expect(occasions({ lastSeenOn: back(9) })).toEqual([]);
    // Every case below: the person last came 12 days ago.
    const gone = { lastSeenOn: back(12) };
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
    expect(occasions({ lastSeenOn: back(30), staff: true })).toEqual([]);
    expect(occasions({ lastSeenOn: null, lastVisitOn: null, visits: 0 })).toEqual([]);
  });

  it("counts from the last check-in of ANY kind: somebody who taps in themselves every day has not been away", () => {
    // The desk checked them in twelve days ago; they tapped "I'm here" today.
    expect(occasions({ lastVisitOn: back(12), lastSeenOn: back(0) })).toEqual([]);
    expect(occasions({ lastVisitOn: back(12), lastSeenOn: back(3) })).toEqual([]);
    // Never checked in at the desk, tapped in twelve days ago and not since.
    expect(occasions({ visits: 0, lastVisitOn: null, lastSeenOn: back(12) })).toEqual([`miss_you absent:${back(12)}`]);
  });

  it("is only for an absence of a while: nobody who stopped coming long ago is told on the first day", () => {
    const table: [number, boolean][] = [[10, true], [25, true], [40, true], [41, false], [100, false], [400, false]];
    for (const [days, due] of table) expect(occasions({ lastSeenOn: back(days) }, { visitDays: lastDays(500) }), String(days)).toEqual(due ? [`miss_you absent:${back(days)}`] : []);
    // By the gym's own number: 7 days, so up to 37.
    const seven = { ...GYM_MESSAGE_STARTING_NUMBERS, missYouDays: 7 };
    expect(occasions({ lastSeenOn: back(37) }, { numbers: seven, visitDays: lastDays(500) })).toHaveLength(1);
    expect(occasions({ lastSeenOn: back(38) }, { numbers: seven, visitDays: lastDays(500) })).toEqual([]);
  });

  it("follows the gym's own number", () => {
    const seven = { ...GYM_MESSAGE_STARTING_NUMBERS, missYouDays: 7 };
    expect(occasions({ lastSeenOn: back(7) }, { numbers: seven })).toEqual([`miss_you absent:${back(7)}`]);
    expect(occasions({ lastSeenOn: back(6) }, { numbers: seven })).toEqual([]);
  });
});

describe("a visit milestone", () => {
  const at = (visits: number, recentVisitDays: number, lastVisitOn: string = TODAY) => occasions({ visits, recentVisitDays, lastVisitOn });
  it("is the newest one reached by a visit of the last seven days, and stays due on each of them", () => {
    // visits, how many of them in the last seven days, the newest.
    const table: [number, number, string, string[]][] = [
      [49, 1, TODAY, []],
      [50, 1, TODAY, ["milestone visits:50"]],
      [50, 1, back(1), ["milestone visits:50"]],
      // The 50th two days ago, and a birthday took yesterday's one message: still due.
      [50, 1, back(2), ["milestone visits:50"]],
      [50, 1, back(6), ["milestone visits:50"]],
      // A week on it is no longer news.
      [50, 0, back(7), []],
      // The 50th yesterday and the 51st today.
      [51, 2, TODAY, ["milestone visits:50"]],
      [51, 1, TODAY, []],
      [52, 2, TODAY, []],
      [56, 7, TODAY, ["milestone visits:50"]],
      [57, 7, TODAY, []],
      [100, 1, TODAY, ["milestone visits:100"]],
      [101, 2, TODAY, ["milestone visits:100"]],
      // Somebody already past a number when the gym first uses this is not told of it.
      [73, 3, TODAY, []],
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
    // More than seven recent days cannot be: read as seven.
    expect(at(57, 99)).toEqual([]);
    expect(at(56, 99)).toEqual(["milestone visits:50"]);
  });

  it("one message a day: a birthday goes before a milestone, which goes the next day if it still can", () => {
    const due = gymMessageDue(facts({ visits: 50, recentVisitDays: 1, lastVisitOn: TODAY, birthday: "10-09" }));
    expect(due.send).toEqual({ kind: "birthday", occasion: "birthday:2026" });
    expect(due.held).toEqual([{ kind: "milestone", occasion: "visits:50", reason: "another_today" }]);
  });
});

describe("a birthday is read only from a date of birth a person could have", () => {
  const on = (born: string | null, today = TODAY, shared = false) => trustedBirthday(born, today, shared);
  it("a real date of birth is its month and day", () => {
    expect(on("1990-10-09")).toBe("10-09");
    expect(on("1996-02-29", "2027-02-28")).toBe("02-29");
    expect(on("1950-06-15")).toBe("06-15");
    // Eighteen today.
    expect(on("2008-10-09")).toBe("10-09");
  });

  // Dates a list holds that are nobody's birthday. Not from the code's own list: what
  // spreadsheets, computers and forms write, and the ones 20b-i's review sent through.
  const STAND_INS: [string, string, string][] = [
    ["the day a computer writes for no date", "1970-01-01", "2027-01-01"],
    ["that day, written west of Greenwich", "1969-12-31", "2026-12-31"],
    ["a system that starts in 2000", "2000-01-01", "2027-01-01"],
    ["one that starts in 1980", "1980-01-01", "2027-01-01"],
    ["one that starts in 2001", "2001-01-01", "2027-01-01"],
    ["only the year was known", "1987-01-01", "2027-01-01"],
    ["the last day of a year, the same way", "1999-12-31", "2026-12-31"],
    ["a spreadsheet's first day", "1900-01-01", "2027-01-01"],
    ["the day before it", "1899-12-30", "2026-12-30"],
    ["a date box left at today", "2026-10-09", "2026-10-09"],
    ["a record added a year ago with that day's date", "2025-10-09", "2026-10-09"],
    ["a small child", "2023-10-09", "2026-10-09"],
    ["seventeen", "2009-10-09", "2026-10-09"],
    ["eighteen tomorrow", "2008-10-10", "2026-10-09"],
    ["not yet born", "2027-10-09", "2026-10-09"],
    ["over 110", "1915-10-09", "2026-10-09"],
    ["no date at all", "", "2026-10-09"],
    ["a day that is not one", "1990-02-30", "2026-10-09"],
  ];
  it.each(STAND_INS)("%s is no birthday", (_name, born, today) => {
    expect(on(born, today)).toBeNull();
  });

  it("a date many of the gym's records share is no birthday, and no date is none", () => {
    expect(on("1990-10-09", TODAY, true)).toBeNull();
    expect(on(null)).toBeNull();
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
    expect(say("milestone", "visits:50", "Maya Rao")).toBe("You've reached 50 visits at Iron House, Maya. Well done.");
    expect(say("milestone", "visits:1000", null)).toBe("You've reached 1,000 visits at Iron House. Well done.");
    expect(say("welcome", "joined:2026-10-09", "Maya Rao", "Your first class is free.")).toBe(
      "Welcome to Iron House, Maya. We're glad you joined. Messages from us will show up here.\nYour first class is free.",
    );
    expect(say("birthday", "birthday:2026", "Maya", "   ")).toBe("Happy birthday, Maya! From everyone at Iron House.");
  });

  it("an ending that names no last day, and a milestone that names no number, say nothing", () => {
    for (const kind of ["membership_ending", "trial_ending"] as const) expect(automaticMessage({ kind, occasion: "x" }, "Iron House", "Maya", "A line")).toBeNull();
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
      { kind: "trial_check_in", on: true, ownLine: null, days: 3, milestones: null },
      { kind: "trial_ending", on: false, ownLine: null, days: 1, milestones: null },
      { kind: "membership_ending", on: true, ownLine: null, days: 14, milestones: null },
      { kind: "payment_overdue", on: false, ownLine: null, days: 9, milestones: null },
    ]);
    expect(set.on).toEqual({ ...GYM_MESSAGE_STARTING_ON, birthday: false, trial_ending: false, payment_overdue: false });
    // A payment notice has no number of its own: it goes by the gym's grace period for bills.
    expect(set.numbers).toEqual({ trialCheckInDay: 3, trialEndingDays: 1, missYouDays: 21, membershipEndingDays: 14, milestones: [10, 100] });
    expect(set.ownLines).toEqual({ birthday: "Cake at the desk" });
  });

  it("a number that is not one is left at its start", () => {
    const set = gymMessageSettingsFrom([
      { kind: "miss_you", on: true, ownLine: null, days: 0, milestones: null },
      { kind: "milestone", on: true, ownLine: null, days: 5, milestones: [50, -1] },
      { kind: "welcome", on: true, ownLine: null, days: 3, milestones: [1] },
      { kind: "trial_check_in", on: true, ownLine: null, days: 0, milestones: null },
      { kind: "trial_ending", on: true, ownLine: null, days: 1.5, milestones: null },
      { kind: "membership_ending", on: true, ownLine: null, days: null, milestones: [7] },
    ]);
    expect(set.numbers).toEqual(GYM_MESSAGE_STARTING_NUMBERS);
  });

  it("a save names every kind once and only numbers on offer; a member's switch only a kind with one", () => {
    const messages = GYM_MESSAGE_SETTING_KINDS.map((kind) => ({ kind, on: true, ownLine: null }));
    const ok = { messages, missYouDays: 14, milestones: [25, 250], trialCheckInDay: 3, trialEndingDays: 1, membershipEndingDays: 30 };
    expect(messages.map((m) => m.kind)).toEqual(["welcome", "trial_check_in", "trial_ending", "membership_ending", "payment_overdue", "birthday", "milestone", "miss_you"]);
    expect(gymMessageSettingsRequestSchema.safeParse(ok).success).toBe(true);
    const bad = [
      { ...ok, missYouDays: 12 },
      { ...ok, trialCheckInDay: 1 },
      { ...ok, trialEndingDays: 5 },
      { ...ok, membershipEndingDays: 10 },
      { ...ok, paymentOverdueDays: 3 },
      { ...ok, messages: [] },
      { ...ok, milestones: [25, 25] },
      { ...ok, milestones: [] },
      { ...ok, milestones: [60] },
      { ...ok, messages: [...messages.slice(1), messages[1]] },
      { ...ok, messages: messages.map((m) => ({ ...m, days: 3 })) },
      { ...ok, extra: true },
    ];
    for (const body of bad) expect(gymMessageSettingsRequestSchema.safeParse(body).success, JSON.stringify(body).slice(0, 80)).toBe(false);
    // A page loaded before the four new kinds: the four it knows and its two numbers. Its save still holds.
    const older = { messages: messages.filter((m) => ["welcome", "birthday", "milestone", "miss_you"].includes(m.kind)), missYouDays: 14, milestones: [25, 250] };
    expect(gymMessageSettingsRequestSchema.parse(older)).toEqual(older);
    for (const kind of GYM_MESSAGE_MEMBER_SWITCH_KINDS) expect(gymMessageSwitchRequestSchema.safeParse({ kind, on: false }).success).toBe(true);
    expect([...GYM_MESSAGE_MEMBER_SWITCH_KINDS]).toEqual(["trial_check_in", "trial_ending", "membership_ending", "birthday", "milestone", "miss_you"]);
    for (const kind of ["welcome", "payment_overdue", "group", "x"]) expect(gymMessageSwitchRequestSchema.safeParse({ kind, on: false }).success, kind).toBe(false);
  });

  it("an inbox from an older server, with no switches in it, reads as none off", () => {
    const reply = { gymId: "11111111-1111-4111-8111-111111111111", gymName: "Iron House", status: "shown", messages: [], unread: 0, asOf: "2026-10-09T06:31:00.000Z" };
    expect(gymInboxResponseSchema.parse(reply).off).toEqual([]);
    expect(gymInboxResponseSchema.parse({ ...reply, off: ["birthday"] }).off).toEqual(["birthday"]);
    expect(gymInboxResponseSchema.safeParse({ ...reply, off: ["advert"] }).success).toBe(false);
  });
});
