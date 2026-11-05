// An early cancellation fee on a minimum term (ROADMAP 18v-ii-b).
//
// The first block is the worst thing this job could do to a real person: charge the fee to somebody
// who is not leaving a running minimum term early: released, still to start, past the term, ending
// with it anyway, or charged a second time. Every date below was read off the calendar (`date -d`),
// not worked out by the code.
import { describe, expect, it } from "vitest";
import {
  agreementFacts,
  billsToOpen,
  cancelHeldMembershipRequestSchema,
  giveHeldMembership,
  heldMembershipView,
  linkHeldMembership,
  moveHeldMembership,
  saveGymMembershipTypeRequestSchema,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
/** Twelve months' minimum term from 1 October 2026, to 30 September 2027, then it renews; $99 to leave early. */
const term12: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900 };
const LEAVE: HeldMembershipEvent = { type: "cancel", when: "leave_early" };

function given(type: HeldMembershipTerms, startsOn: string, today: string, billDay: number | null = null): HeldMembership {
  const made = giveHeldMembership(type, startsOn, true, today, billDay);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

function moved(m: HeldMembership, event: HeldMembershipEvent, today: string): HeldMembership {
  const move = moveHeldMembership(m, event, today);
  if (!move.ok) throw new Error(`refused: ${JSON.stringify(event)} on ${today}: ${move.reason}`);
  return move.membership;
}

/** Given on 1 October 2026, October paid: paid to 31 October. */
const ana = (type: HeldMembershipTerms = term12): HeldMembership => given(type, "2026-10-01", "2026-10-01");

function daysFrom(from: string, days: number): string[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

/** Pays every bill as it opens on each day, and says which periods were billed. */
function payAsBilled(m: HeldMembership, days: string[]): number[] {
  let now = m;
  const billed: number[] = [];
  for (const day of days) {
    for (const bill of billsToOpen(now, day, new Set())) {
      billed.push(bill.periodIndex);
      now = moved(now, { type: "paid", paidPeriods: now.paidPeriods + 1 }, day);
    }
  }
  return billed;
}

describe("the worst thing: the fee only for leaving a running minimum term early, once", () => {
  // Each case: the membership, the day, and the last day leaving early would give, or null for no fee.
  const cases: [string, () => HeldMembership, string, string | null][] = [
    ["inside the term, paid ahead", () => ana(), "2026-10-20", "2026-10-31"],
    ["inside the term, this month not paid: ends today", () => ({ ...ana(), paidPeriods: 1 }), "2026-11-05", "2026-11-05"],
    ["a line with no fee", () => ana({ ...term12, leaveFeeMinor: null }), "2026-10-20", null],
    ["a fee of 0", () => ({ ...ana(), leaveFeeMinor: 0 }), "2026-10-20", null],
    ["no minimum term at all", () => ({ ...ana(monthly), leaveFeeMinor: 9900 }), "2026-10-20", null],
    ["still to start", () => given(term12, "2026-11-01", "2026-10-20"), "2026-10-20", null],
    ["paid to the term's last day: ends with it anyway", () => ({ ...ana(), paidPeriods: 12 }), "2027-08-10", null],
    ["paid to the month before the term's last", () => ({ ...ana(), paidPeriods: 11 }), "2027-08-10", "2027-08-31"],
    ["past the term, renewing", () => ({ ...ana(), paidPeriods: 13 }), "2027-10-05", null],
    ["released: ends at the end of what is paid", () => moved(ana(), { type: "cancel", when: "period_end", release: "death" }, "2026-10-20"), "2026-10-20", null],
    ["released today", () => moved(ana(), { type: "cancel", when: "today", release: "moved" }, "2026-10-20"), "2026-10-20", null],
    ["set to end with the term", () => moved(ana(), { type: "cancel", when: "contract_end" }, "2026-10-20"), "2026-10-20", "2026-10-31"],
    ["left early already", () => moved(ana(), LEAVE, "2026-10-20"), "2026-10-21", null],
  ];
  it.each(cases)("%s", (_, make, today, endsOn) => {
    const m = make();
    const view = heldMembershipView(m, today);
    expect(view.can.leaveEarly).toEqual(endsOn === null ? null : { feeMinor: 9900, endsOn });
    const move = moveHeldMembership(m, LEAVE, today);
    if (endsOn === null) {
      // Refused, or the same request again: never a second fee.
      expect(move.ok ? move.changed && move.membership.leftEarly === true && m.leftEarly !== true : false).toBe(false);
    } else {
      expect(move.ok && move.changed && move.membership.leftEarly).toBe(true);
      if (move.ok) expect(heldMembershipView(move.membership, today).endsOn).toBe(endsOn);
    }
  });

  it("leaving early on 20 October keeps October, then nothing is billed for two years", () => {
    const out = moved(ana(), LEAVE, "2026-10-20");
    expect(out).toMatchObject({ renews: false, leftEarly: true, status: "active" });
    expect(payAsBilled(out, daysFrom("2026-10-20", 730))).toEqual([]);
    const view = heldMembershipView(out, "2026-10-20");
    expect(view).toMatchObject({ endsOn: "2026-10-31", contract: null });
    expect(view.can.releaseNeeded).toBe(false);
    // The same press again changes nothing.
    const again = moveHeldMembership(out, LEAVE, "2026-10-20");
    expect(again.ok && again.changed).toBe(false);
    expect(heldMembershipView(out, "2026-11-01").status).toBe("ended");
  });
});

describe("where it ends", () => {
  it("with 30 days' notice, it runs to the end of the month the notice ends in, and is billed for it", () => {
    const out = moved(ana({ ...term12, noticeDays: 30 }), LEAVE, "2026-10-20");
    // 20 October + 29 days is 18 November: November is the last month.
    expect(out).toMatchObject({ renews: true, stopsAfter: 2, leftEarly: true });
    expect(heldMembershipView(out, "2026-10-20")).toMatchObject({ endsOn: "2026-11-30", contract: null });
    expect(payAsBilled(out, daysFrom("2026-10-20", 730))).toEqual([1]);
  });

  it("notice given already, to the term's end: leaving early runs no longer than the notice from today", () => {
    const noticed: HeldMembership = { ...ana({ ...term12, noticeDays: 30 }), stopsAfter: 12 };
    const out = moved(noticed, LEAVE, "2026-10-25");
    expect(out).toMatchObject({ stopsAfter: 2, leftEarly: true });
  });

  it("a term that ends by itself takes no notice: it ends at the end of what is paid", () => {
    const m = { ...ana({ ...term12, contractThen: "ends" }), noticeDays: 30 };
    expect(heldMembershipView(m, "2026-10-20").can.leaveEarly).toEqual({ feeMinor: 9900, endsOn: "2026-10-31" });
    expect(moved(m, LEAVE, "2026-10-20")).toMatchObject({ renews: false, leftEarly: true });
  });

  it("frozen with no notice, it ends today, as a release does", () => {
    const frozen = moved(ana(), { type: "freeze" }, "2026-10-10");
    expect(heldMembershipView(frozen, "2026-10-20").can.leaveEarly).toEqual({ feeMinor: 9900, endsOn: "2026-10-20" });
    expect(moved(frozen, LEAVE, "2026-10-20")).toMatchObject({ status: "cancelled", cancelledOn: "2026-10-20", frozenOn: null, leftEarly: true });
  });

  it("frozen with a notice, the ten days frozen so far move its end", () => {
    const frozen = moved(ana({ ...term12, noticeDays: 30 }), { type: "freeze" }, "2026-10-10");
    // Frozen 10 days: November runs 11 November to 10 December, and holds 18 November.
    expect(heldMembershipView(frozen, "2026-10-20").can.leaveEarly).toEqual({ feeMinor: 9900, endsOn: "2026-12-10" });
    expect(moved(frozen, LEAVE, "2026-10-20")).toMatchObject({ status: "frozen", stopsAfter: 2, leftEarly: true });
  });

  it("billed from the gym's day: the part month is what is paid, and it ends the day before the 15th", () => {
    const m = given(term12, "2026-10-01", "2026-10-01", 15);
    expect(m.fullFrom).toBe("2026-10-15");
    expect(heldMembershipView(m, "2026-10-10").can.leaveEarly).toEqual({ feeMinor: 9900, endsOn: "2026-10-14" });
  });

  it("weekly, inside a 26-week term", () => {
    const m = given({ ...term12, termUnit: "week", contractPeriods: 26 }, "2026-10-01", "2026-10-01");
    expect(heldMembershipView(m, "2026-10-03").can.leaveEarly).toEqual({ feeMinor: 9900, endsOn: "2026-10-07" });
  });

  it("left early with a notice, ending sooner still asks why, and no second fee is offered", () => {
    const out = moved(ana({ ...term12, noticeDays: 30 }), LEAVE, "2026-10-20");
    const sooner = moveHeldMembership(out, { type: "cancel", when: "today" }, "2026-10-22");
    expect(sooner).toEqual({ ok: false, reason: "release_needed" });
    const released = moved(out, { type: "cancel", when: "today", release: "moved" }, "2026-10-22");
    expect(released).toMatchObject({ status: "cancelled", leftEarly: true });
    expect(heldMembershipView(released, "2026-10-22").can.leaveEarly).toBeNull();
  });
});

describe("what a membership is given, what a gym may type, what a cancel may send", () => {
  it("a membership keeps the fee of a line with a minimum term only; one taken from the gym's own list has none", () => {
    expect(ana().leaveFeeMinor).toBe(9900);
    expect(ana({ ...monthly, leaveFeeMinor: 9900 }).leaveFeeMinor).toBeNull();
    const linked = linkHeldMembership(term12, { endsOn: null, endsOnKind: null }, true, "2026-11-10");
    expect(linked.ok && linked.membership.leaveFeeMinor).toBe(null);
  });

  const line = {
    name: "Gold", description: null, kind: "recurring", priceMinor: 5000, termCount: 1, termUnit: "month", packClasses: null, packDays: null,
    access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null, contractPeriods: 12, contractThen: "renews",
  };
  it("a fee on a line with a minimum term, at least a cent", () => {
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, leaveFeeMinor: 9900 }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, contractThen: "ends", leaveFeeMinor: 1 }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, leaveFeeMinor: 0 }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, leaveFeeMinor: 9.5 }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, contractPeriods: null, contractThen: null, leaveFeeMinor: 9900 }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.parse(line).leaveFeeMinor).toBeNull();
  });

  it("leaving early sends the fee and no reason; nothing else sends a fee", () => {
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "leave_early", leaveFeeMinor: 9900 }).success).toBe(true);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "leave_early" }).success).toBe(false);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "leave_early", leaveFeeMinor: 9900, release: "moved" }).success).toBe(false);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "today", leaveFeeMinor: 9900 }).success).toBe(false);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "today", release: "moved" }).success).toBe(true);
  });

  it("the signed agreement says the fee beside the minimum term, and its tax inside it", () => {
    const m = ana();
    const facts = (tax: { name: string; pcm: number } | null) =>
      agreementFacts({
        gym: { name: "Iron Works", postalAddress: null, contactPhone: null, contactEmail: null },
        personName: "Ana Silva",
        membership: {
          typeName: "Gold 12",
          kind: "recurring",
          priceMinor: 5000,
          currency: "USD",
          termCount: 1,
          termUnit: "month",
          packClasses: null,
          startsOn: "2026-10-01",
          discount: null,
          tax,
          view: heldMembershipView(m, "2026-10-01"),
          contractPeriods: 12,
          leaveFeeMinor: 9900,
        },
        firstBill: null,
        taxIncluded: false,
      });
    expect(facts(null)).toContainEqual({ label: "Early cancellation fee", value: "$99.00" });
    expect(facts({ name: "Sales tax", pcm: 8250 })).toContainEqual({ label: "Early cancellation fee", value: "$99.00, Sales tax included" });
  });
});
