// No new bookings while a payment is overdue (ROADMAP Stage 2 item 17i; Kd, 2026-10-22).
//
// The worst thing this job could do to a real person: stop a member who has paid, or whose
// payment is not yet late by the gym's own days of grace, from booking their class. So the
// first block is exactly that. The table's answers are written out case by case from the
// spec's words (a bill reads Overdue once more than the gym's days of grace have passed
// after its due date, spec Part 3 §14.2), never read back from the rule.
import { describe, expect, it } from "vitest";
import {
  CHECKIN_RULES_START,
  bookingSettingsBodySchema,
  bookingStopped,
  bookingTime,
  checkinStop,
  decideBook,
  memberBillState,
  paymentOverdue,
  type BookInput,
  type BookingOverdue,
} from "../src/index.js";

const TODAY = "2026-10-23";

describe("the worst thing: somebody who has paid, or is not late yet, is never stopped", () => {
  it("nothing owed, under Stop new bookings, with no days of grace", () => {
    expect(bookingStopped({ rule: "stop", staff: false, owedSince: null, today: TODAY, overdueAfterDays: 0 })).toBe(false);
  });
  it("a bill due today, under Stop new bookings, with no days of grace", () => {
    expect(bookingStopped({ rule: "stop", staff: false, owedSince: TODAY, today: TODAY, overdueAfterDays: 0 })).toBe(false);
  });
  it("a bill on the last day of the gym's 3 days of grace", () => {
    expect(bookingStopped({ rule: "stop", staff: false, owedSince: "2026-10-20", today: TODAY, overdueAfterDays: 3 })).toBe(false);
  });
});

// [what is owed, due on, days of grace, overdue today]
const OWED: readonly [string, string | null, number, boolean][] = [
  ["nothing owed", null, 0, false],
  ["nothing owed, 60 days of grace", null, 60, false],
  ["due today, no grace", "2026-10-23", 0, false],
  ["due yesterday, no grace", "2026-10-22", 0, true],
  ["due a year ago, no grace", "2025-10-23", 0, true],
  ["due tomorrow (not yet due)", "2026-10-24", 0, false],
  ["due 3 days ago, 3 days of grace", "2026-10-20", 3, false],
  ["due 4 days ago, 3 days of grace", "2026-10-19", 3, true],
  ["due 1 day ago, 1 day of grace", "2026-10-22", 1, false],
  ["due 2 days ago, 1 day of grace", "2026-10-21", 1, true],
  ["due 60 days ago, 60 days of grace", "2026-08-24", 60, false],
  ["due 61 days ago, 60 days of grace", "2026-08-23", 60, true],
  ["due the last day of last month, across the month's end", "2026-09-30", 22, true],
  ["across a leap day", "2028-02-28", 0, true],
];

describe("when a payment is overdue: one test, the same on the bill, at the desk and for bookings", () => {
  it.each(OWED)("%s", (_, owedSince, days, overdue) => {
    const today = owedSince === "2028-02-28" ? "2028-02-29" : TODAY;
    expect(paymentOverdue(owedSince, today, days)).toBe(overdue);
    // The bill on the person's page reads Overdue on exactly the same day.
    if (owedSince !== null) expect(memberBillState({ status: "open", dueOn: owedSince }, today, days) === "overdue").toBe(overdue);
    // The front desk sends them to staff on exactly the same day, where the gym asks it to.
    const desk = checkinStop({ rules: { ...CHECKIN_RULES_START, overdue: "see_staff" }, staff: false, held: null, owedSince, today, overdueAfterDays: days, waiverSigned: null });
    expect(desk === "overdue").toBe(overdue);
  });
});

describe("whom the gym's choice stops", () => {
  const cases: [BookingOverdue, boolean, string, string | null, number, boolean][] = [];
  for (const rule of ["let_book", "stop"] as const) {
    for (const staff of [false, true]) {
      for (const [name, owedSince, days, overdue] of OWED) cases.push([rule, staff, name, owedSince, days, rule === "stop" && !staff && overdue]);
    }
  }
  it.each(cases)("%s · staff %s · %s", (rule, staff, _, owedSince, days, stopped) => {
    const today = owedSince === "2028-02-28" ? "2028-02-29" : TODAY;
    expect(bookingStopped({ rule, staff, owedSince, today, overdueAfterDays: days })).toBe(stopped);
  });
});

describe("what a stopped person can and cannot do with a class", () => {
  const START = Date.UTC(2026, 9, 30, 17, 0);
  const settings = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 60, waitlistMax: 20 };
  const base: BookInput = {
    time: bookingTime(START - 48 * 60 * 60_000, START, settings),
    cancelled: false,
    places: 10,
    booked: 4,
    waitlisted: 0,
    waitlistMax: 20,
    mine: null,
    joinWaitlist: false,
    cover: { ok: true, membershipId: null, chargePack: false },
    overdue: true,
  };
  const full = { ...base, booked: 10, waitlisted: 2 };
  // [case, input, the answer]
  const table: [string, BookInput, ReturnType<typeof decideBook>][] = [
    ["Book a free place", base, { kind: "refuse", reason: "payment_overdue" }],
    ["Book, the waitlist asked too", { ...base, joinWaitlist: true }, { kind: "refuse", reason: "payment_overdue" }],
    ["Join the waitlist of a full class", { ...full, joinWaitlist: true }, { kind: "refuse", reason: "payment_overdue" }],
    ["Book a full class", full, { kind: "refuse", reason: "payment_overdue" }],
    ["Claim a freed place from the waitlist", { ...base, mine: "waitlisted", waitlisted: 1 }, { kind: "refuse", reason: "payment_overdue" }],
    ["A place they hold already stays", { ...base, mine: "booked" }, { kind: "already", status: "booked" }],
    ["A full class they wait for already: still waiting", { ...full, mine: "waitlisted", joinWaitlist: true }, { kind: "already", status: "waitlisted" }],
    ["A cancelled class says so first", { ...base, cancelled: true }, { kind: "refuse", reason: "class_cancelled" }],
    ["No membership says so first", { ...base, cover: { ok: false, reason: "no_membership" } }, { kind: "refuse", reason: "no_membership" }],
    ["Not stopped: a free place is booked", { ...base, overdue: false }, { kind: "book", membershipId: null, chargePack: false, fromWaitlist: false }],
    ["Not stopped: the waitlist is joined", { ...full, joinWaitlist: true, overdue: false }, { kind: "waitlist" }],
    ["Not stopped: a freed place is claimed", { ...base, mine: "waitlisted", waitlisted: 1, overdue: false }, { kind: "book", membershipId: null, chargePack: false, fromWaitlist: true }],
  ];
  it.each(table)("%s", (_, input, answer) => {
    expect(decideBook(input)).toEqual(answer);
  });
});

describe("the choice as a save sends it", () => {
  const body = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 60, waitlistMax: 20, pt: { opensDays: 7, freeCancelMinutes: 120 } };
  it("is one of the two choices, or left out to stay as it is", () => {
    expect(bookingSettingsBodySchema.safeParse({ ...body, overdue: "stop" }).success).toBe(true);
    expect(bookingSettingsBodySchema.safeParse({ ...body, overdue: "let_book" }).success).toBe(true);
    expect(bookingSettingsBodySchema.safeParse(body).success).toBe(true);
    expect(bookingSettingsBodySchema.safeParse({ ...body, overdue: "see_staff" }).success).toBe(false);
    expect(bookingSettingsBodySchema.safeParse({ ...body, overdue: true }).success).toBe(false);
  });
});
