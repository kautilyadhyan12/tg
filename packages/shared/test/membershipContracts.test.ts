// A contract on a repeating membership (ROADMAP 18v-i).
//
// The first block is the worst thing this job could do to a real person: charge them for a
// month after their contract ended, or after the gym let them out of it because they moved
// away or died. Every date below was read off a 2026–2028 calendar, not worked out by the code.
import { describe, expect, it } from "vitest";
import {
  billsToOpen,
  contractLengthWords,
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
/** Twelve monthly payments, then it ends: what a gym in Quebec sells. */
const yearThenEnds: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "ends" };
/** Twelve monthly payments, then month to month. */
const yearThenRenews: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "renews" };

function given(type: HeldMembershipTerms, startsOn: string, today: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, true, today);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

function moved(m: HeldMembership, event: HeldMembershipEvent, today: string): HeldMembership {
  const move = moveHeldMembership(m, event, today);
  if (!move.ok) throw new Error(`refused: ${JSON.stringify(event)} on ${today}: ${move.reason}`);
  return move.membership;
}

/** Pays every period as its bill opens, from `from` to `to`, and says which periods were billed. */
function payEveryMonth(m: HeldMembership, days: string[]): { m: HeldMembership; billed: number[] } {
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

/** The 3rd of every month from November 2026 to March 2028. */
const THIRDS = Array.from({ length: 17 }, (_, i) => {
  const y = 2026 + Math.floor((10 + i) / 12);
  const mo = ((10 + i) % 12) + 1;
  return `${String(y)}-${String(mo).padStart(2, "0")}-03`;
});

describe("the worst thing: nobody is charged after their contract ends or after they are released", () => {
  it("a 12-month contract that ends opens 12 bills and no 13th, and reads Ended on 3 Nov 2027", () => {
    const start = given(yearThenEnds, "2026-11-03", "2026-11-03");
    const { m, billed } = payEveryMonth({ ...start, paidPeriods: 0 }, THIRDS);
    expect(billed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(heldMembershipView(m, "2027-11-02").status).toBe("active");
    expect(heldMembershipView(m, "2027-11-02").endsOn).toBe("2027-11-02");
    expect(heldMembershipView(m, "2027-11-03").status).toBe("ended");
    expect(billsToOpen(m, "2027-11-03", new Set())).toEqual([]);
    expect(billsToOpen(m, "2028-03-03", new Set())).toEqual([]);
  });

  it("a member paid up to the contract's end cannot be marked paid for a month after it", () => {
    let m = given(yearThenEnds, "2026-11-03", "2026-11-03");
    for (let i = 1; i < 12; i += 1) m = moved(m, { type: "paid", paidPeriods: m.paidPeriods + 1 }, "2026-11-03");
    expect(m.paidPeriods).toBe(12);
    const view = heldMembershipView(m, "2026-11-03");
    expect(view.can.markPaid).toBeNull();
    expect(moveHeldMembership(m, { type: "paid", paidPeriods: 13 }, "2026-11-03").ok).toBe(false);
  });

  it("a member released because they moved away, at the end of what is paid, is billed nothing more", () => {
    const m = given(yearThenRenews, "2026-11-03", "2026-11-03");
    // Paid to 2 Feb 2027, released on 20 Jan: it runs to the end of what is paid.
    const paid3 = moved(moved(m, { type: "paid", paidPeriods: 2 }, "2026-12-03"), { type: "paid", paidPeriods: 3 }, "2027-01-03");
    const out = moved(paid3, { type: "cancel", when: "period_end", release: "moved" }, "2027-01-20");
    expect(heldMembershipView(out, "2027-01-20").endsOn).toBe("2027-02-02");
    expect(billsToOpen(out, "2027-02-03", new Set())).toEqual([]);
    expect(billsToOpen(out, "2027-06-03", new Set())).toEqual([]);
  });

  it("a member released today because they died is cancelled today and billed nothing more", () => {
    const m = given(yearThenRenews, "2026-11-03", "2026-11-03");
    const out = moved(m, { type: "cancel", when: "today", release: "death" }, "2027-01-20");
    expect(heldMembershipView(out, "2027-01-20").status).toBe("cancelled");
    expect(billsToOpen(out, "2027-02-03", new Set())).toEqual([]);
  });

  it("End when the contract ends: billed to the end of the contract, then nothing", () => {
    const m = given(yearThenRenews, "2026-11-03", "2026-11-03");
    const set = moved({ ...m, paidPeriods: 0 }, { type: "cancel", when: "contract_end" }, "2027-03-10");
    expect(set.contractThen).toBe("ends");
    const { billed } = payEveryMonth(set, THIRDS);
    expect(billed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(heldMembershipView(set, "2027-03-10").endsOn).toBe("2027-11-02");
  });
});

describe("a contract that renews", () => {
  it("goes on billing month to month after the contract, and the contract line goes once it is over", () => {
    const start = given(yearThenRenews, "2026-11-03", "2026-11-03");
    const { m, billed } = payEveryMonth({ ...start, paidPeriods: 0 }, THIRDS);
    expect(billed).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(heldMembershipView(m, "2027-11-02").contract).toEqual({ until: "2027-11-02", then: "renews" });
    expect(heldMembershipView(m, "2027-11-03").contract).toBeNull();
    expect(heldMembershipView(m, "2027-11-03").can.releaseNeeded).toBe(false);
  });

  it("renews on the 3rd while in contract, and says no renewal past a contract that ends", () => {
    const renews = given(yearThenRenews, "2026-11-03", "2026-11-03");
    const ends = given(yearThenEnds, "2026-11-03", "2026-11-03");
    expect(heldMembershipView(renews, "2027-10-10").renewsOn).toBe("2027-11-03");
    expect(heldMembershipView(ends, "2027-09-10").renewsOn).toBe("2027-10-03");
    expect(heldMembershipView(ends, "2027-10-10").renewsOn).toBeNull();
    expect(heldMembershipView(ends, "2027-10-10").endsOn).toBe("2027-11-02");
  });
});

describe("cancelling inside a contract", () => {
  const m = given(yearThenRenews, "2026-11-03", "2026-11-03");

  it("is refused without a reason, today and at the end of what is paid", () => {
    expect(moveHeldMembership(m, { type: "cancel", when: "today" }, "2027-01-20")).toEqual({ ok: false, reason: "release_needed" });
    expect(moveHeldMembership(m, { type: "cancel", when: "period_end" }, "2027-01-20")).toEqual({ ok: false, reason: "release_needed" });
  });

  it("offers End when the contract ends, with its last day, and asks for a reason for anything sooner", () => {
    const view = heldMembershipView(m, "2027-01-20");
    expect(view.contract).toEqual({ until: "2027-11-02", then: "renews" });
    expect(view.can.cancelAtContractEnd).toBe("2027-11-02");
    expect(view.can.releaseNeeded).toBe(true);
  });

  it("asks for nothing once the contract is over, or before the membership has started", () => {
    expect(moveHeldMembership(m, { type: "cancel", when: "today" }, "2027-11-03").ok).toBe(true);
    const later = given(yearThenRenews, "2026-12-01", "2026-11-03");
    expect(heldMembershipView(later, "2026-11-03").can.releaseNeeded).toBe(false);
    expect(moveHeldMembership(later, { type: "cancel", when: "today" }, "2026-11-03").ok).toBe(true);
  });

  it("sent twice, End when the contract ends changes it once", () => {
    const once = moveHeldMembership(m, { type: "cancel", when: "contract_end" }, "2027-01-20");
    expect(once.ok && once.changed).toBe(true);
    if (!once.ok) return;
    const twice = moveHeldMembership(once.membership, { type: "cancel", when: "contract_end" }, "2027-01-20");
    expect(twice).toMatchObject({ ok: true, changed: false });
  });

  it("a contract that already ends asks for a reason to stop sooner, and has no End-with-contract choice", () => {
    const ends = given(yearThenEnds, "2026-11-03", "2026-11-03");
    const view = heldMembershipView(ends, "2027-01-20");
    expect(view.can.cancelAtContractEnd).toBeNull();
    expect(view.can.releaseNeeded).toBe(true);
    expect(moveHeldMembership(ends, { type: "cancel", when: "today" }, "2027-01-20")).toEqual({ ok: false, reason: "release_needed" });
  });

  it("a freeze moves the contract's end by the days frozen, as it moves every date", () => {
    const frozen = moved(m, { type: "freeze" }, "2027-01-10");
    const back = moved(frozen, { type: "unfreeze" }, "2027-01-20");
    expect(heldMembershipView(back, "2027-01-20").contract?.until).toBe("2027-11-12");
  });
});

describe("where no contract applies", () => {
  it("a membership without one cancels as before, with no reason asked", () => {
    const m = given(monthly, "2026-11-03", "2026-11-03");
    const view = heldMembershipView(m, "2027-01-20");
    expect(view.contract).toBeNull();
    expect(view.can.releaseNeeded).toBe(false);
    expect(moveHeldMembership(m, { type: "cancel", when: "today" }, "2027-01-20").ok).toBe(true);
  });

  it("a membership taken from the gym's own list gets no contract its old software held", () => {
    const linked = linkHeldMembership(yearThenEnds, { endsOn: null, endsOnKind: null }, true, "2026-11-03");
    expect(linked.ok && linked.membership.contractPeriods).toBeNull();
  });

  it("a paid-once type, a free one, and a contract with half its fields are refused on the price list", () => {
    const base = {
      name: "Gold", description: null, kind: "recurring", priceMinor: 5000, termCount: 1, termUnit: "month", packClasses: null, packDays: null,
      access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null,
    };
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, contractPeriods: 12, contractThen: "ends" }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, kind: "one_time", contractPeriods: 12, contractThen: "ends" }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, priceMinor: 0, contractPeriods: 12, contractThen: "ends" }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, contractPeriods: 12 }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...base, contractPeriods: 157, contractThen: "ends" }).success).toBe(false);
  });
});

describe("the contract's length in words", () => {
  it.each([
    [12, 1, "month", "12 months"],
    [24, 1, "month", "2 years"],
    [18, 1, "month", "18 months"],
    [4, 3, "month", "12 months"],
    [1, 1, "year", "1 year"],
    [52, 1, "week", "52 weeks"],
    [1, 1, "week", "1 week"],
  ] as const)("%i payments every %i %s is %s", (periods, count, unit, words) => {
    expect(contractLengthWords(periods, count, unit)).toBe(words);
  });
});
