// A notice to cancel on a repeating membership (ROADMAP 18v-ii-a).
//
// The first block is the worst thing this job could do to a real person: charge them after their
// notice ended, or for a notice the gym let them out of because they moved away or died. Every
// date below was read off the calendar (`date -d`), not worked out by the code.
import { describe, expect, it } from "vitest";
import {
  agreementFacts,
  billsToOpen,
  cancelHeldMembershipRequestSchema,
  giveHeldMembership,
  heldMembershipView,
  linkHeldMembership,
  moveHeldMembership,
  noticeAsked,
  saveGymMembershipTypeRequestSchema,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
const notice30: HeldMembershipTerms = { ...monthly, noticeDays: 30 };

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

/** Paid for October and November 2026: paid to 30 November. */
const ana = (): HeldMembership => ({ ...given(notice30, "2026-10-01", "2026-10-01"), paidPeriods: 2 });

/** Every day from `from` for `days` days. */
function daysFrom(from: string, days: number): string[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

/** Pays every bill as it opens on each day, and says which periods were billed. */
function payAsBilled(m: HeldMembership, days: string[]): { m: HeldMembership; billed: number[] } {
  let now = m;
  const billed: number[] = [];
  for (const day of days) {
    for (const bill of billsToOpen(now, day, new Set())) {
      billed.push(bill.periodIndex);
      now = moved(now, { type: "paid", paidPeriods: now.paidPeriods + 1 }, day);
    }
  }
  return { m: now, billed };
}

describe("the worst thing: nobody is charged after their notice ends, or for a notice they were let out of", () => {
  it("Ana gives 30 days' notice on 10 Nov, paid to 30 Nov: one more payment on 1 Dec, none on 1 Jan", () => {
    const before = heldMembershipView(ana(), "2026-11-10");
    expect(before.notice).toEqual({ days: 30, given: false });
    expect(before.can.cancelAfterNotice).toBe("2026-12-31");
    const m = moved(ana(), { type: "cancel", when: "notice" }, "2026-11-10");
    const view = heldMembershipView(m, "2026-11-10");
    expect(view.endsOn).toBe("2026-12-31");
    expect(view.notice).toEqual({ days: 30, given: true });
    const { m: after, billed } = payAsBilled(m, daysFrom("2026-11-10", 120));
    expect(billed).toEqual([2]);
    expect(heldMembershipView(after, "2026-12-31").status).toBe("active");
    expect(heldMembershipView(after, "2027-01-01").status).toBe("ended");
    expect(billsToOpen(after, "2027-01-01", new Set())).toEqual([]);
    expect(heldMembershipView(after, "2026-12-15").can.markPaid).toBeNull();
  });

  it("Ben, released for a death on 10 Nov, is cancelled that day and billed nothing more", () => {
    const m = moved(ana(), { type: "cancel", when: "today", release: "death" }, "2026-11-10");
    expect(m.status).toBe("cancelled");
    expect(payAsBilled(m, daysFrom("2026-11-10", 120)).billed).toEqual([]);
  });

  it("Cara, let out at the end of what is paid because she moved, ends 30 Nov and is never billed for December", () => {
    const m = moved(ana(), { type: "cancel", when: "period_end", release: "moved" }, "2026-11-10");
    expect(heldMembershipView(m, "2026-11-10").endsOn).toBe("2026-11-30");
    expect(payAsBilled(m, daysFrom("2026-11-10", 120)).billed).toEqual([]);
  });

  it("ending before the notice allows, with no reason, is refused and changes nothing", () => {
    expect(moveHeldMembership(ana(), { type: "cancel", when: "today" }, "2026-11-10")).toEqual({ ok: false, reason: "release_needed" });
    expect(moveHeldMembership(ana(), { type: "cancel", when: "period_end" }, "2026-11-10")).toEqual({ ok: false, reason: "release_needed" });
  });
});

describe("where the notice ends", () => {
  const cases: { name: string; today: string; paid: number; days: number; offered: string | null; ends: string }[] = [
    { name: "notice ending inside December runs to 31 Dec", today: "2026-11-25", paid: 2, days: 30, offered: "2026-12-31", ends: "2026-12-31" },
    { name: "notice ending on 1 Jan runs to 31 Jan", today: "2026-12-03", paid: 3, days: 30, offered: "2027-01-31", ends: "2027-01-31" },
    { name: "paid past the notice: the end of what is paid is the same day, offered once", today: "2026-11-10", paid: 3, days: 30, offered: null, ends: "2026-12-31" },
    { name: "a 1-day notice inside what is paid is the end of what is paid", today: "2026-11-10", paid: 2, days: 1, offered: null, ends: "2026-11-30" },
    { name: "nothing paid for November yet: November and December", today: "2026-11-10", paid: 1, days: 30, offered: "2026-12-31", ends: "2026-12-31" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const m: HeldMembership = { ...given({ ...monthly, noticeDays: c.days }, "2026-10-01", "2026-10-01"), paidPeriods: c.paid };
      const view = heldMembershipView(m, c.today);
      expect(view.can.cancelAfterNotice).toBe(c.offered);
      expect(view.can.noticeEnds).toBe(c.ends);
      // At the end of what is paid asks why only where that is before the notice's end.
      const paidTo = view.can.cancelAtPeriodEnd;
      expect(noticeAsked(view, "period_end")).toBe(paidTo !== null && paidTo < c.ends);
      expect(noticeAsked(view, "today")).toBe(true);
    });
  }

  it("weekly, 14 days' notice on Wed 4 Nov: runs to Sun 22 Nov", () => {
    const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week", noticeDays: 14 };
    const m = given(weekly, "2026-11-02", "2026-11-02");
    expect(heldMembershipView(m, "2026-11-04").can.cancelAfterNotice).toBe("2026-11-22");
    const after = moved(m, { type: "cancel", when: "notice" }, "2026-11-04");
    expect(payAsBilled(after, daysFrom("2026-11-04", 60)).billed).toEqual([1, 2]);
  });

  it("billed from the gym's day (the 1st), started 20 Oct: the part month is not counted as a payment", () => {
    const m: HeldMembership = { ...given(notice30, "2026-10-20", "2026-10-20", 1), paidPeriods: 2 };
    expect(m.fullFrom).toBe("2026-11-01");
    expect(heldMembershipView(m, "2026-11-10").can.cancelAfterNotice).toBe("2026-12-31");
  });

  it("frozen on 5 Nov, notice given on 10 Nov: the five days frozen move its end to 5 Jan, as the unfreeze does", () => {
    const frozen = moved(ana(), { type: "freeze" }, "2026-11-05");
    expect(heldMembershipView(frozen, "2026-11-10").can.cancelAfterNotice).toBe("2027-01-05");
    const noticed = moved(frozen, { type: "cancel", when: "notice" }, "2026-11-10");
    const back = moved(noticed, { type: "unfreeze" }, "2026-11-10");
    expect(heldMembershipView(back, "2026-11-10").endsOn).toBe("2027-01-05");
  });
});

describe("notice and a minimum term", () => {
  const term = (): HeldMembership => ({ ...given({ ...notice30, contractPeriods: 12, contractThen: "renews" }, "2026-10-01", "2026-10-01"), paidPeriods: 2 });

  it("well inside the term: End on 30 Sep 2027 is offered, and the notice is no other day", () => {
    const view = heldMembershipView(term(), "2026-11-10");
    expect(view.can.cancelAtContractEnd).toBe("2027-09-30");
    expect(view.can.cancelAfterNotice).toBeNull();
  });

  it("two weeks before the term ends: the notice runs past it, so it ends 31 Oct 2027 and not with the term", () => {
    const m: HeldMembership = { ...term(), paidPeriods: 12 };
    const view = heldMembershipView(m, "2027-09-15");
    expect(view.can.cancelAtContractEnd).toBeNull();
    expect(view.can.cancelAfterNotice).toBe("2027-10-31");
    expect(moveHeldMembership(m, { type: "cancel", when: "contract_end" }, "2027-09-15").ok).toBe(false);
  });

  it("a term that ends by itself takes no notice: it ends with the term", () => {
    const m: HeldMembership = { ...given({ ...notice30, contractPeriods: 12, contractThen: "ends" }, "2026-10-01", "2026-10-01"), paidPeriods: 2 };
    const view = heldMembershipView(m, "2026-11-10");
    expect(view.can.cancelAfterNotice).toBeNull();
    expect(view.can.noticeEnds).toBeNull();
  });

  it("a release inside the term lets them out of the notice too, with one reason", () => {
    const m = moved(term(), { type: "cancel", when: "today", release: "medical" }, "2026-11-10");
    expect(m.status).toBe("cancelled");
  });
});

describe("what is unchanged, and a request sent twice", () => {
  it("notice given twice is one change", () => {
    const once = moved(ana(), { type: "cancel", when: "notice" }, "2026-11-10");
    const twice = moveHeldMembership(once, { type: "cancel", when: "notice" }, "2026-11-12");
    expect(twice).toEqual({ ok: true, membership: once, changed: false });
    expect(heldMembershipView(once, "2026-11-12").can.cancelAfterNotice).toBeNull();
  });

  it("after notice, ending today still asks why; with a reason it is cancelled", () => {
    const once = moved(ana(), { type: "cancel", when: "notice" }, "2026-11-10");
    expect(moveHeldMembership(once, { type: "cancel", when: "today" }, "2026-11-20")).toEqual({ ok: false, reason: "release_needed" });
    expect(moved(once, { type: "cancel", when: "today", release: "other" }, "2026-11-20").status).toBe("cancelled");
  });

  it("a membership still to start cancels as before, with no notice", () => {
    const m = given(notice30, "2026-12-01", "2026-11-10");
    const view = heldMembershipView(m, "2026-11-10");
    expect(view.can.cancelAfterNotice).toBeNull();
    expect(view.can.noticeEnds).toBeNull();
    expect(moved(m, { type: "cancel", when: "today" }, "2026-11-10").status).toBe("cancelled");
  });

  it("one with no notice cancels as before, and refuses a notice", () => {
    const m: HeldMembership = { ...given(monthly, "2026-10-01", "2026-10-01"), paidPeriods: 2 };
    expect(heldMembershipView(m, "2026-11-10").notice).toBeNull();
    expect(moved(m, { type: "cancel", when: "today" }, "2026-11-10").status).toBe("cancelled");
    expect(moveHeldMembership(m, { type: "cancel", when: "notice" }, "2026-11-10")).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("a free type, and one taken from the gym's own list, hold no notice", () => {
    expect(given({ ...notice30, priceMinor: 0 }, "2026-10-01", "2026-10-01").noticeDays).toBeNull();
    const linked = linkHeldMembership(notice30, { endsOn: null, endsOnKind: null }, true, "2026-11-10");
    expect(linked.ok && linked.membership.noticeDays).toBe(null);
  });
});

describe("what a gym may type, and what a cancel may send", () => {
  const base = {
    name: "Gold", description: null, kind: "recurring", priceMinor: 5000, termCount: 1, termUnit: "month", packClasses: null, packDays: null,
    access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null,
  };
  it("1 to 90 days on a repeating line with a price", () => {
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, noticeDays: 30 }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, noticeDays: 90 }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, noticeDays: 0 }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, noticeDays: 91 }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, priceMinor: 0, noticeDays: 30 }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, kind: "one_time", noticeDays: 30 }).success).toBe(false);
  });

  it("giving notice sends no reason", () => {
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "notice" }).success).toBe(true);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "notice", release: "moved" }).success).toBe(false);
  });

  it("the signed agreement says the notice while it renews", () => {
    const m = ana();
    const facts = agreementFacts({
      gym: { name: "Iron Works", postalAddress: null, contactPhone: null, contactEmail: null },
      personName: "Ana Silva",
      membership: {
        typeName: "Gold Monthly",
        kind: "recurring",
        priceMinor: 5000,
        currency: "USD",
        termCount: 1,
        termUnit: "month",
        packClasses: null,
        startsOn: "2026-10-01",
        discount: null,
        tax: null,
        view: heldMembershipView(m, "2026-10-01"),
      },
      firstBill: null,
      taxIncluded: false,
    });
    expect(facts).toContainEqual({ label: "Notice to cancel", value: "30 days" });
  });
});
