// The Members list says Overdue (ROADMAP Stage 2 item 17i-ii; Kd, 2026-10-23).
//
// The worst thing this job could do to a real person: show somebody who has paid, or whose
// payment is not late yet by the gym's own days of grace, as "Overdue". So the first block is
// exactly that. The answers are written out case by case from the spec's words (a bill reads
// Overdue once more than the gym's days of grace have passed after its due date, spec Part 3
// §14.2), never read back from the rule.
import { describe, expect, it } from "vitest";
import { memberBillState, rowSaysOverdue, type HeldOnList } from "../src/index.js";

/** Wednesday 7 October 2026. */
const TODAY = "2026-10-07";
const GRACE = 3;

const row = (payment: HeldOnList["payment"]): HeldOnList => ({
  status: "active",
  memberships: ["Gold Monthly"],
  day: { what: "renews", on: "2026-11-01" },
  payment,
});
const due = (since: string | null) => row({ state: "due", since });

describe("THE WORST THING: nobody who has paid, or is still inside the days of grace, is Overdue", () => {
  const never: [string, Parameters<typeof rowSaysOverdue>[0]][] = [
    ["paid", { shown: row({ state: "paid" }), former: false, owedSince: null, today: TODAY, overdueAfterDays: GRACE }],
    ["free", { shown: row({ state: "free" }), former: false, owedSince: null, today: TODAY, overdueAfterDays: GRACE }],
    ["not due yet", { shown: row({ state: "later", on: "2026-10-10" }), former: false, owedSince: null, today: TODAY, overdueAfterDays: GRACE }],
    ["due today", { shown: due(TODAY), former: false, owedSince: TODAY, today: TODAY, overdueAfterDays: GRACE }],
    ["due 2 days ago", { shown: due("2026-10-05"), former: false, owedSince: "2026-10-05", today: TODAY, overdueAfterDays: GRACE }],
    ["the last day of grace", { shown: due("2026-10-04"), former: false, owedSince: "2026-10-04", today: TODAY, overdueAfterDays: GRACE }],
    // A membership from the gym's own file whose renewal has passed: no bill here to be Overdue.
    ["Payment due with no bill of ours", { shown: due("2026-09-01"), former: false, owedSince: null, today: TODAY, overdueAfterDays: GRACE }],
    // Their own list's word names a membership they never held: the gym's words show, not ours.
    ["the gym's own words", { shown: null, former: false, owedSince: "2026-09-01", today: TODAY, overdueAfterDays: GRACE }],
    ["a past member who owes nothing", { shown: null, former: true, owedSince: null, today: TODAY, overdueAfterDays: GRACE }],
    ["staff who are not shown bills", { shown: due("2026-09-01"), former: false, owedSince: "2026-09-01", today: TODAY, overdueAfterDays: null }],
    ["a past member, to staff who are not shown bills", { shown: null, former: true, owedSince: "2026-09-01", today: TODAY, overdueAfterDays: null }],
  ];
  it.each(never)("%s", (_, input) => {
    expect(rowSaysOverdue(input)).toBe(false);
  });
});

describe("Overdue the day after the last day of grace", () => {
  const overdue: [string, Parameters<typeof rowSaysOverdue>[0]][] = [
    ["one day past grace", { shown: due("2026-10-03"), former: false, owedSince: "2026-10-03", today: TODAY, overdueAfterDays: GRACE }],
    ["a month late", { shown: due("2026-09-01"), former: false, owedSince: "2026-09-01", today: TODAY, overdueAfterDays: GRACE }],
    ["no grace, due yesterday", { shown: due("2026-10-06"), former: false, owedSince: "2026-10-06", today: TODAY, overdueAfterDays: 0 }],
    // The file's renewal is newer, the bill older: the bill decides.
    ["an old bill beside a newer renewal", { shown: due("2026-09-01"), former: false, owedSince: "2026-09-02", today: TODAY, overdueAfterDays: GRACE }],
    ["a past member who left a bill unpaid", { shown: null, former: true, owedSince: "2026-10-01", today: TODAY, overdueAfterDays: GRACE }],
    ["the longest grace, one day past", { shown: due("2026-08-07"), former: false, owedSince: "2026-08-07", today: TODAY, overdueAfterDays: 60 }],
  ];
  it.each(overdue)("%s", (_, input) => {
    expect(rowSaysOverdue(input)).toBe(true);
  });

  it("says Overdue exactly when the bill on the person's page does", () => {
    for (let back = 0; back <= 70; back += 1) {
      const dueOn = new Date(Date.UTC(2026, 9, 7 - back)).toISOString().slice(0, 10);
      for (const days of [0, 1, GRACE, 30, 60]) {
        const bill = memberBillState({ status: "open", dueOn }, TODAY, days);
        expect(rowSaysOverdue({ shown: due(dueOn), former: false, owedSince: dueOn, today: TODAY, overdueAfterDays: days }), `${dueOn} +${String(days)}`).toBe(bill === "overdue");
      }
    }
  });
});
