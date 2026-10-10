// A list's membership word linked to a type (spec Part 3 §13.2; ROADMAP 17a-iii).
//
// The worst thing this job could do to a real person: show a paid-up member as owing
// or ended. The list's own day is the fact, so every expected day below is the list's
// day read back, and the month-end cases were read off a 2026–2029 calendar (2028 is
// the leap year).
import { describe, expect, it } from "vitest";
import {
  addDays,
  heldMembershipView,
  linkHeldMembership,
  moveHeldMembership,
  shownRenewal,
  type HeldMembership,
  type HeldMembershipTerms,
  type ListMembershipDates,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week" };
const fortnightly: HeldMembershipTerms = { ...monthly, termCount: 2, termUnit: "week" };
const quarterly: HeldMembershipTerms = { ...monthly, termCount: 3 };
const halfYearly: HeldMembershipTerms = { ...monthly, termCount: 6 };
const yearly: HeldMembershipTerms = { ...monthly, termUnit: "year" };
const oneMonth: HeldMembershipTerms = { ...monthly, kind: "one_time" };
const threeMonths: HeldMembershipTerms = { ...oneMonth, termCount: 3 };
const oneYear: HeldMembershipTerms = { ...oneMonth, termUnit: "year" };
const tenDays: HeldMembershipTerms = { ...oneMonth, termCount: 10, termUnit: "day" };
const freeWeek: HeldMembershipTerms = { ...monthly, kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

const renews = (day: string): ListMembershipDates => ({ endsOn: day, endsOnKind: "renews" });
const ends = (day: string): ListMembershipDates => ({ endsOn: day, endsOnKind: "ends" });
const NO_DAY: ListMembershipDates = { endsOn: null, endsOnKind: null };

function linked(type: HeldMembershipTerms, dates: ListMembershipDates, paid: boolean, today: string) {
  const made = linkHeldMembership(type, dates, paid, today);
  if (!made.ok) throw new Error(`not linked: ${made.reason}`);
  return made;
}

describe("a paid-up member on the list is never shown as owing or ended", () => {
  it("a repeating membership keeps the list's renewal day and is paid up to it", () => {
    // [type, the list's day, today, the renewal shown, paid up to]
    const cases: [HeldMembershipTerms, ListMembershipDates, string, string, string][] = [
      [monthly, renews("2026-11-14"), "2026-10-20", "2026-11-14", "2026-11-14"],
      [monthly, renews("2026-10-05"), "2026-10-04", "2026-10-05", "2026-10-05"],
      // "Ends 31 Dec" is the last day paid for: the next payment is due the day after.
      [monthly, ends("2026-12-31"), "2026-12-04", "2027-01-01", "2027-01-01"],
      // One month before 31 Mar is 28 Feb, and one month on from that is 28 Mar.
      [monthly, renews("2027-03-31"), "2027-03-15", "2027-03-31", "2027-03-31"],
      [monthly, renews("2027-03-30"), "2027-03-29", "2027-03-30", "2027-03-30"],
      [monthly, renews("2028-02-29"), "2028-02-10", "2028-02-29", "2028-02-29"],
      [quarterly, renews("2027-05-31"), "2027-04-01", "2027-05-31", "2027-05-31"],
      [halfYearly, renews("2027-08-31"), "2027-08-30", "2027-08-31", "2027-08-31"],
      [yearly, renews("2028-02-29"), "2027-06-01", "2028-02-29", "2028-02-29"],
      [weekly, renews("2026-10-09"), "2026-10-04", "2026-10-09", "2026-10-09"],
      [fortnightly, ends("2026-10-10"), "2026-10-04", "2026-10-11", "2026-10-11"],
      // Paid three months ahead on a monthly: the rule renews it each month, nothing is
      // owed until the list's day, and the list's day is the one a screen prints.
      [monthly, renews("2027-01-14"), "2026-10-20", "2026-11-14", "2027-01-14"],
      // A year paid on a type set up as monthly (round one, H1).
      [monthly, renews("2027-04-22"), "2026-10-04", "2026-10-22", "2027-04-22"],
      // 2 January 2027 is a Saturday: the Saturday after 4 October 2026 is the 10th.
      [weekly, ends("2027-01-01"), "2026-10-04", "2026-10-10", "2027-01-02"],
    ];
    for (const [type, dates, today, renewal, until] of cases) {
      const label = `${String(type.termCount)} ${String(type.termUnit)}, list ${String(dates.endsOnKind)} ${String(dates.endsOn)}, today ${today}`;
      const made = linked(type, dates, false, today);
      const view = heldMembershipView(made.membership, today);
      expect(made.group, label).toBe("settled");
      expect(view.status, label).toBe("active");
      expect(view.renewsOn, label).toBe(renewal);
      // What a screen prints as "Renews": the list's own day, never an earlier one.
      expect(shownRenewal(view), label).toBe(until);
      expect(view.payment, label).toEqual({ state: "paid", until });
      // The periods up to the list's day are the list's fact: no mark of staff's to take back.
      expect(view.can.undoPaid, label).toBeNull();
      // The day before the list's day they still owe nothing; on it, the payment is due.
      expect(heldMembershipView(made.membership, addDays(until, -1)).payment, label).toEqual({ state: "paid", until });
      expect(heldMembershipView(made.membership, until).payment, label).toEqual({ state: "due", since: until });
      expect(heldMembershipView(made.membership, until).status, label).toBe("active");
    }
  });

  it("after the list's day is paid, renewals stay on the list's day of the month", () => {
    const made = linked(monthly, renews("2027-03-31"), false, "2027-03-15");
    let m: HeldMembership = made.membership;
    const days: string[] = [];
    for (const today of ["2027-03-31", "2027-04-30", "2027-05-31"]) {
      const next = heldMembershipView(m, today).can.markPaid;
      if (next === null) throw new Error("cannot be marked paid");
      const move = moveHeldMembership(m, { type: "paid", paidPeriods: next.paidPeriods }, today);
      if (!move.ok) throw new Error("refused");
      m = move.membership;
      days.push(String(heldMembershipView(m, today).renewsOn));
    }
    expect(days).toEqual(["2027-04-30", "2027-05-31", "2027-06-30"]);
  });

  it("a membership that ends keeps the list's last day, and has started", () => {
    // [type, the list's day, today, the last day shown]
    const cases: [HeldMembershipTerms, ListMembershipDates, string, string][] = [
      [threeMonths, ends("2026-12-31"), "2026-10-04", "2026-12-31"],
      // No one-month term from any start reaches 30 Mar: the list's day is kept anyway.
      [oneMonth, ends("2027-03-30"), "2027-03-10", "2027-03-30"],
      [oneMonth, ends("2028-02-29"), "2028-02-01", "2028-02-29"],
      // The list's day is further off than the type's own term: it has still started.
      [oneYear, ends("2027-12-31"), "2026-10-04", "2027-12-31"],
      [tenDays, ends("2026-12-25"), "2026-10-04", "2026-12-25"],
      // "Renews 14 Nov" on a type that does not renew: the day before is its last.
      [threeMonths, renews("2026-11-14"), "2026-10-04", "2026-11-13"],
      // The last day is today.
      [threeMonths, ends("2026-10-04"), "2026-10-04", "2026-10-04"],
      [tenPack, ends("2026-11-15"), "2026-10-04", "2026-11-15"],
      [tenPack, ends("2027-06-30"), "2026-10-04", "2027-06-30"],
      [freeWeek, ends("2026-10-08"), "2026-10-04", "2026-10-08"],
    ];
    for (const [type, dates, today, last] of cases) {
      const label = `${type.kind}, list ${String(dates.endsOnKind)} ${String(dates.endsOn)}, today ${today}`;
      const made = linked(type, dates, true, today);
      expect(made.membership.startsOn <= today, label).toBe(true);
      expect(heldMembershipView(made.membership, today).status, label).toBe("active");
      expect(heldMembershipView(made.membership, today).endsOn, label).toBe(last);
      expect(heldMembershipView(made.membership, last).status, label).toBe("active");
      expect(heldMembershipView(made.membership, addDays(last, 1)).status, label).toBe("ended");
    }
  });

  it("every day of two years, from two days, every term: the list's day is the day shown", () => {
    const todays = ["2026-10-04", "2028-02-29"];
    const repeating = [weekly, fortnightly, monthly, quarterly, halfYearly, yearly, { ...yearly, termCount: 2 }];
    const ending = [oneMonth, threeMonths, oneYear, tenDays, tenPack];
    let checked = 0;
    for (const today of todays) {
      for (let edge = addDays(today, 1); edge < addDays(today, 800); edge = addDays(edge, 1)) {
        for (const type of repeating) {
          const made = linked(type, renews(edge), false, today);
          const view = heldMembershipView(made.membership, today);
          const label = `${String(type.termCount)} ${String(type.termUnit)} renews ${edge}, today ${today}`;
          expect(made.membership.frozenDays, label).toBe(0);
          expect(made.membership.startsOn <= today, label).toBe(true);
          expect(view.status, label).toBe("active");
          expect(view.payment, label).toEqual({ state: "paid", until: edge });
          expect(shownRenewal(view), label).toBe(edge);
          expect(view.can.undoPaid, label).toBeNull();
          expect(view.can.cancelAtPeriodEnd, label).toBe(addDays(edge, -1));
          checked += 1;
        }
        for (const type of ending) {
          const made = linked(type, ends(addDays(edge, -1)), true, today);
          const label = `${type.kind} ends ${addDays(edge, -1)}, today ${today}`;
          expect(made.membership.startsOn <= today, label).toBe(true);
          expect(heldMembershipView(made.membership, today).endsOn, label).toBe(addDays(edge, -1));
          expect(heldMembershipView(made.membership, addDays(edge, -1)).status, label).toBe("active");
          expect(heldMembershipView(made.membership, edge).status, label).toBe("ended");
          checked += 1;
        }
      }
    }
    expect(checked).toBe(2 * 799 * 12);
  });
});

describe("what the list's day does not settle", () => {
  // Kd, RULINGS 2026-10-10: the months between the list's day and now were the gym's other
  // software's to ask about. The person owes from the period today falls in, on the list's
  // own day of the month (the 3rd; the 31st is the 30th in September).
  it("a renewal day that has passed is a payment due since the period today falls in, never for the months before, never an ended membership", () => {
    for (const [dates, today, since] of [
      [renews("2026-09-03"), "2026-10-04", "2026-10-03"],
      [renews("2026-09-03"), "2026-10-02", "2026-09-03"],
      [renews("2026-10-04"), "2026-10-04", "2026-10-04"],
      [ends("2026-10-03"), "2026-10-04", "2026-10-04"],
      [renews("2024-10-31"), "2026-10-04", "2026-09-30"],
    ] as const) {
      const made = linked(monthly, dates, true, today);
      const view = heldMembershipView(made.membership, today);
      expect(made.group).toBe("due");
      expect(view.status).toBe("active");
      expect(view.payment).toEqual({ state: "due", since });
      // The periods before the list's day are not this app's to take back.
      expect(view.can.undoPaid).toBeNull();
      expect(view.can.markPaid).not.toBeNull();
    }
  });

  it("a membership the list says is over is not given", () => {
    for (const type of [oneMonth, threeMonths, tenPack, freeWeek]) {
      expect(linkHeldMembership(type, ends("2026-10-03"), true, "2026-10-04")).toEqual({ ok: false, reason: "ended_in_list" });
      expect(linkHeldMembership(type, renews("2026-10-04"), true, "2026-10-04")).toEqual({ ok: false, reason: "ended_in_list" });
    }
  });

  it("with no day on the list it starts today, and staff say whether it is paid", () => {
    const today = "2026-10-04";
    const unpaid = linked(monthly, NO_DAY, false, today);
    expect(unpaid.group).toBe("ask");
    expect(unpaid.membership.startsOn).toBe(today);
    expect(heldMembershipView(unpaid.membership, today).payment).toEqual({ state: "due", since: today });
    const paid = linked(monthly, NO_DAY, true, today);
    expect(heldMembershipView(paid.membership, today).payment).toEqual({ state: "paid", until: "2026-11-04" });
    expect(heldMembershipView(paid.membership, today).renewsOn).toBe("2026-11-04");

    // A membership that ends: the list's day says how long, not whether it is paid.
    const ending = linked(threeMonths, ends("2026-12-31"), false, today);
    expect(ending.group).toBe("ask");
    expect(heldMembershipView(ending.membership, today).payment).toEqual({ state: "due", since: ending.membership.startsOn });
    expect(heldMembershipView(linked(threeMonths, ends("2026-12-31"), true, today).membership, today).payment).toEqual({ state: "paid", until: null });
    expect(linked(tenPack, NO_DAY, true, today).membership.classesLeft).toBe(10);
  });

  it("a free type has nothing to ask and nothing to pay", () => {
    const today = "2026-10-04";
    for (const dates of [NO_DAY, ends("2026-10-08")]) {
      const made = linked(freeWeek, dates, true, today);
      expect(made.group).toBe("settled");
      expect(made.membership.paidPeriods).toBe(0);
      expect(heldMembershipView(made.membership, today).payment).toBeNull();
    }
    // Free and renewing: nothing is paid up to anything, so the day printed is the next renewal.
    const freeAhead = linked({ ...monthly, priceMinor: 0 }, renews("2027-04-22"), true, today);
    expect(shownRenewal(heldMembershipView(freeAhead.membership, today))).toBe("2026-10-22");
    const freeMonthly = linked({ ...monthly, priceMinor: 0 }, renews("2026-09-14"), true, today);
    expect(freeMonthly.group).toBe("settled");
    expect(freeMonthly.membership.paidPeriods).toBe(0);
    expect(heldMembershipView(freeMonthly.membership, today).renewsOn).toBe("2026-10-14");
  });

  it("a day the calendar does not have, or one too far off, is not taken", () => {
    const today = "2026-10-04";
    for (const day of ["2026-02-30", "not a day", "1999-12-31", "2000-01-01", "2040-01-01"]) {
      expect(linkHeldMembership(monthly, renews(day), true, today)).toEqual({ ok: false, reason: "day_out_of_range" });
    }
    // A day whose worked-back start would be before the first day a membership can start
    // (a membership given by hand cannot start there either).
    for (const day of ["2000-01-10", "2000-01-31"]) {
      expect(linkHeldMembership(monthly, renews(day), true, today)).toEqual({ ok: false, reason: "day_out_of_range" });
    }
    const first = linkHeldMembership(monthly, renews("2000-02-01"), true, today);
    expect(first.ok && first.membership.startsOn).toBe("2000-01-01");
    expect(linkHeldMembership({ ...monthly, kind: "one_time", termCount: 300, termUnit: "year" }, ends("2027-01-01"), true, today)).toEqual({ ok: false, reason: "day_out_of_range" });
    expect(linkHeldMembership(monthly, renews(addDays(today, 5 * 366)), true, today).ok).toBe(true);
    expect(linkHeldMembership(monthly, renews(addDays(today, 5 * 366 + 1)), true, today).ok).toBe(false);
  });

  it("what it stores passes the table's own rules", () => {
    const today = "2026-10-04";
    for (const [type, dates] of [
      [monthly, renews("2026-11-14")],
      [monthly, renews("2025-01-31")],
      [yearly, renews("2028-02-29")],
      [oneMonth, ends("2027-03-30")],
      [oneYear, ends("2030-12-31")],
      [tenPack, ends("2027-06-30")],
      [freeWeek, NO_DAY],
    ] as const) {
      for (const paid of [true, false]) {
        const m = linked(type, dates, paid, today).membership;
        expect(m.frozenDays >= 0 && m.frozenDays <= 36500).toBe(true);
        expect(m.paidFloor >= 0 && m.paidPeriods >= m.paidFloor).toBe(true);
        if (m.kind !== "recurring") expect(m.paidPeriods <= 1 && m.paidFloor === 0).toBe(true);
        if (m.free) expect(m.paidPeriods).toBe(0);
        expect(m.status).toBe("active");
      }
    }
  });
});
